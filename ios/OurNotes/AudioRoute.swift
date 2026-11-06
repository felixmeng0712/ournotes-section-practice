import AVFoundation
import WebKit

/// Tells the page which audio output is in use, as the game's BluetoothAudioDetector does, so it can switch to the
/// Bluetooth timing and volume settings: calls `window.onAudioRoute({kind, name, latency})` when the page asks
/// (`webkit.messageHandlers.audioRoute.postMessage(0)`) and whenever the route changes. kind is bluetooth, wired,
/// speaker, airplay or other; latency is the session's output latency in ms (Bluetooth: the headset's delay).
final class AudioRoute: NSObject, WKScriptMessageHandler {
    weak var webView: WKWebView?

    override init() {
        super.init()
        NotificationCenter.default.addObserver(self, selector: #selector(changed),
                                               name: AVAudioSession.routeChangeNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(changed),
                                               name: UIApplication.didBecomeActiveNotification, object: nil)
    }

    func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage) { send() }

    @objc private func changed() { DispatchQueue.main.async { self.send() } }

    private func send() {
        // only read here: activating the session ourselves stalls WebKit's AudioContext (see AppDelegate)
        let s = AVAudioSession.sharedInstance(), out = s.currentRoute.outputs.first
        let kind: String
        switch out?.portType {
        case .bluetoothA2DP?, .bluetoothLE?, .bluetoothHFP?: kind = "bluetooth"
        case .headphones?, .usbAudio?, .lineOut?: kind = "wired"
        case .builtInSpeaker?, .builtInReceiver?: kind = "speaker"
        case .airPlay?: kind = "airplay"
        default: kind = "other"
        }
        let info: [String: Any] = ["kind": kind, "name": out?.portName ?? "", "latency": Int((s.outputLatency * 1000).rounded())]
        guard let data = try? JSONSerialization.data(withJSONObject: info), let json = String(data: data, encoding: .utf8) else { return }
        webView?.evaluateJavaScript("window.onAudioRoute && window.onAudioRoute(\(json))")
    }
}
