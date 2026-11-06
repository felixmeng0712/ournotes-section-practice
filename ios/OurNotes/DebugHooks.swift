#if DEBUG
import WebKit

/// Debug builds only: print the page's console to stdout, and run a test script passed in
/// the ONP_TEST_JS environment variable (`SIMCTL_CHILD_ONP_TEST_JS=… xcrun simctl launch --console-pty …`).
enum DebugHooks {
    private final class Log: NSObject, WKScriptMessageHandler {
        func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage) {
            print(String(format: "%.3f", Date().timeIntervalSince1970.truncatingRemainder(dividingBy: 1000)), m.body)
        }
    }

    static func install(_ cfg: WKWebViewConfiguration) {
        setvbuf(stdout, nil, _IOLBF, 0)   // stdout is a pipe under `devicectl --console`: flush every line
        cfg.userContentController.add(Log(), name: "log")
        let forward = """
        (() => { const send = (k, a) => webkit.messageHandlers.log.postMessage(k + ' ' + a.map(String).join(' '));
          for (const k of ['log', 'warn', 'error']) { const o = console[k]; console[k] = (...a) => { send(k, a); o.apply(console, a); }; }
          addEventListener('error', e => send('uncaught', [e.message, e.filename + ':' + e.lineno]));
          addEventListener('unhandledrejection', e => send('unhandled', [e.reason && (e.reason.stack || e.reason)])); })();
        """
        cfg.userContentController.addUserScript(WKUserScript(source: forward, injectionTime: .atDocumentStart, forMainFrameOnly: true))
    }

    static func runTest(in webView: WKWebView) {
        guard let js = ProcessInfo.processInfo.environment["ONP_TEST_JS"] else { return }
        webView.callAsyncJavaScript(js, arguments: [:], in: nil, in: .page) { result in
            switch result {
            case .success(let v): print("[test] result", v)
            case .failure(let e): print("[test] failed", e)
            }
        }
    }
}
#endif
