import Foundation
import UniformTypeIdentifiers
import WebKit

/// The iOS counterpart of server.py, served on ournotes://app/:
/// the bundled web app, a caching proxy for /yatta/<path> → bdon.yatta.moe,
/// and the /api/cached and /api/offline endpoints the page uses.
final class LocalScheme: NSObject, WKURLSchemeHandler {
    static let scheme = "ournotes"
    static let home = URL(string: "ournotes://app/index.html")!

    private let web = Bundle.main.resourceURL!.appendingPathComponent("web")
    private let data: URL
    private let logs: URL   // judgement logs (Application Support/logs); pull with `devicectl device copy from`
    #if DEBUG
    private let upstream = URL(string: ProcessInfo.processInfo.environment["ONP_UPSTREAM"] ?? "https://bdon.yatta.moe/Resources/en/")!
    #else
    private let upstream = URL(string: "https://bdon.yatta.moe/Resources/en/")!
    #endif
    private let ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
    private let session: URLSession
    private let work = DispatchQueue(label: "scheme", qos: .userInitiated, attributes: .concurrent)

    private let lock = NSLock()
    private var stopped = Set<ObjectIdentifier>()
    private var refreshing = Set<String>()

    override init() {
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        var dir = support.appendingPathComponent("data", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        // ~200 MB of re-downloadable files: keep it out of iCloud backups (Caches could be purged before a flight)
        var rv = URLResourceValues(); rv.isExcludedFromBackup = true
        try? dir.setResourceValues(rv)
        data = dir
        logs = support.appendingPathComponent("logs", isDirectory: true)
        let cfg = URLSessionConfiguration.default
        cfg.requestCachePolicy = .reloadIgnoringLocalCacheData
        cfg.httpMaximumConnectionsPerHost = 6
        session = URLSession(configuration: cfg)
    }

    // MARK: WKURLSchemeHandler

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        let path = task.request.url?.path ?? "/"
        let req = task.request
        work.async {
            let (code, type, body) = path == "/api/log" ? self.saveLog(req) : self.route(path)
            DispatchQueue.main.async { self.reply(task, code, type, body) }
        }
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {
        lock.lock(); stopped.insert(ObjectIdentifier(task)); lock.unlock()
    }

    private func reply(_ task: WKURLSchemeTask, _ code: Int, _ type: String, _ body: Data) {
        lock.lock(); let gone = stopped.remove(ObjectIdentifier(task)) != nil; lock.unlock()
        if gone { return }   // calling into a stopped task raises
        let headers = ["Content-Type": type, "Content-Length": String(body.count), "Cache-Control": "no-cache"]
        let res = HTTPURLResponse(url: task.request.url!, statusCode: code, httpVersion: "HTTP/1.1", headerFields: headers)!
        task.didReceive(res)
        task.didReceive(body)
        task.didFinish()
    }

    // MARK: routing

    private typealias Reply = (Int, String, Data)

    private func route(_ path: String) -> Reply {
        if path.hasPrefix("/yatta/") { return proxy(String(path.dropFirst("/yatta/".count))) }
        if path == "/api/cached" { return json(cachedList()) }
        if path == "/api/offline" { return json(offlineStatus()) }
        let rel = path == "/" ? "index.html" : String(path.dropFirst())
        guard let parts = safeParts(rel) else { return json(["error": "bad path"], 400) }
        let file = parts.reduce(web) { $0.appendingPathComponent($1) }
        guard let body = try? Data(contentsOf: file) else { return json(["error": "not found"], 404) }
        return (200, mime(file), body)
    }

    private func safeParts(_ rel: String) -> [String]? {
        let parts = rel.split(separator: "/", omittingEmptySubsequences: false).map(String.init)
        if rel.isEmpty || parts.contains(where: { $0.isEmpty || $0 == "." || $0 == ".." }) { return nil }
        return parts
    }

    // metadata that changes when songs are added; everything else is immutable enough
    private func networkFirst(_ path: String) -> Bool {
        path == "MasterParsed/songs.json" || path.hasPrefix("MasterParsed/songs/")
    }

    private func proxy(_ path: String) -> Reply {
        guard let parts = safeParts(path) else { return json(["error": "bad path"], 400) }
        let local = parts.reduce(data) { $0.appendingPathComponent($1) }
        let type = mime(local)
        if let cached = try? Data(contentsOf: local) {
            if networkFirst(path), let fresh = refresh(path, local, wait: 3) { return (200, type, fresh) }
            return (200, type, cached)
        }
        switch fetch(path, timeout: 30, tries: 2) {
        case .ok(let body):
            save(body, to: local)
            return (200, type, body)
        case .status(let code) where code < 500:
            return json(["error": "upstream \(code)"], code)
        default:
            // the page shows this as "not cached and offline"
            return json(["error": "offline and not cached"], 504)
        }
    }

    /// Re-download a cached file in the background; give the caller the new copy only if it arrives within `wait` seconds.
    private func refresh(_ path: String, _ local: URL, wait: TimeInterval) -> Data? {
        lock.lock()
        let busy = !refreshing.insert(path).inserted
        lock.unlock()
        if busy { return nil }
        let done = DispatchSemaphore(value: 0)
        var result: Data?
        work.async {
            if case .ok(let body) = self.fetch(path, timeout: 15, tries: 1) {
                self.save(body, to: local)
                result = body
            }
            self.lock.lock(); self.refreshing.remove(path); self.lock.unlock()
            done.signal()
        }
        return done.wait(timeout: .now() + wait) == .success ? result : nil
    }

    private enum Fetched { case ok(Data), status(Int), failed }

    private func fetch(_ path: String, timeout: TimeInterval, tries: Int) -> Fetched {
        // _static/<x> is yatta's shared Resources/static/<x> (note skin), a sibling of the en/ tree
        let rel = path.hasPrefix("_static/") ? "../static/" + path.dropFirst("_static/".count) : path
        let encoded = rel.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? rel
        var req = URLRequest(url: URL(string: encoded, relativeTo: upstream)!, timeoutInterval: timeout)
        req.setValue(ua, forHTTPHeaderField: "User-Agent")
        var last = Fetched.failed
        for _ in 0..<tries {
            let done = DispatchSemaphore(value: 0)
            session.dataTask(with: req) { body, res, _ in
                if let code = (res as? HTTPURLResponse)?.statusCode {
                    last = code == 200 && body != nil ? .ok(body!) : .status(code)
                }
                done.signal()
            }.resume()
            done.wait()
            if case .ok = last { return last }
            if case .status(let c) = last, c < 500 { return last }   // a real 404 won't change on retry
        }
        return last
    }

    private func save(_ body: Data, to local: URL) {
        try? FileManager.default.createDirectory(at: local.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? body.write(to: local, options: .atomic)
    }

    // MARK: judgement logs

    private func saveLog(_ req: URLRequest) -> Reply {
        var body = req.httpBody ?? Data()
        if body.isEmpty, let s = req.httpBodyStream {
            s.open(); defer { s.close() }
            var buf = [UInt8](repeating: 0, count: 65536)
            while body.count <= 4 << 20 { let n = s.read(&buf, maxLength: buf.count); if n <= 0 { break }; body.append(buf, count: n) }
        }
        guard req.httpMethod == "POST", !body.isEmpty, body.count <= 4 << 20,
              (try? JSONSerialization.jsonObject(with: body)) != nil else { return json(["error": "bad log"], 400) }
        try? FileManager.default.createDirectory(at: logs, withIntermediateDirectories: true)
        let f = DateFormatter(); f.dateFormat = "yyyyMMdd-HHmmss-SSS"; f.locale = Locale(identifier: "en_US_POSIX")
        let name = f.string(from: Date()) + ".json"
        try? body.write(to: logs.appendingPathComponent(name), options: .atomic)
        // keep the newest 500
        if let all = try? FileManager.default.contentsOfDirectory(atPath: logs.path).filter({ $0.hasSuffix(".json") }).sorted(), all.count > 500 {
            for old in all.prefix(all.count - 500) { try? FileManager.default.removeItem(at: logs.appendingPathComponent(old)) }
        }
        return json(["saved": name])
    }

    // MARK: offline status

    private func cachedList() -> [String] {
        let base = data.standardizedFileURL.path + "/"
        guard let walk = FileManager.default.enumerator(at: data, includingPropertiesForKeys: [.isRegularFileKey]) else { return [] }
        return walk.compactMap { item -> String? in
            guard let url = item as? URL, (try? url.resourceValues(forKeys: [.isRegularFileKey]))?.isRegularFile == true else { return nil }
            return String(url.standardizedFileURL.path.dropFirst(base.count))
        }
    }

    // per song: how many of its files (detail, jacket, audio, charts) are on disk
    private func offlineStatus() -> [String: [String: Int]] {
        let songs = data.appendingPathComponent("MasterParsed/songs")
        let names = (try? FileManager.default.contentsOfDirectory(atPath: songs.path)) ?? []
        var out: [String: [String: Int]] = [:]
        for name in names where name.hasSuffix(".json") {
            guard let raw = try? Data(contentsOf: songs.appendingPathComponent(name)),
                  let s = try? JSONSerialization.jsonObject(with: raw) as? [String: Any],
                  let jacket = s["jacket"], let file = s["filename"], let meta = s["meta"] as? [[String: Any]] else { continue }
            var need = ["Assets/AddressableResources/Image/Jacket/\(jacket).webp",
                        "Assets/AddressableResources/Cri/Sound/MusicScore/\(file).opus"]
            need += meta.compactMap { $0["filename"] }.map { "Assets/AddressableResources/Live/MusicScore/\($0).json" }
            let have = need.filter { FileManager.default.fileExists(atPath: data.appendingPathComponent($0).path) }.count
            out[String(name.dropLast(5))] = ["have": have + 1, "need": need.count + 1]
        }
        return out
    }

    // MARK: helpers

    private func json(_ obj: Any, _ code: Int = 200) -> Reply {
        (code, "application/json", (try? JSONSerialization.data(withJSONObject: obj)) ?? Data())
    }

    private func mime(_ url: URL) -> String {
        switch url.pathExtension.lowercased() {
        case "html": return "text/html; charset=utf-8"
        case "js", "mjs": return "text/javascript; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "json": return "application/json"
        case "opus": return "audio/ogg"
        case "webp": return "image/webp"
        case "woff2": return "font/woff2"
        case "wasm": return "application/wasm"
        default: return UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
        }
    }
}
