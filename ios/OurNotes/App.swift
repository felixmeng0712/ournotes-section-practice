import UIKit
import WebKit

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // The page's audio runs in WebKit's own process, which manages the app's audio session itself (the page sets
        // navigator.audioSession.type = 'playback' to play through the silent switch). Activating the session here as
        // well made WebKit's AudioContext stall about a second after launch.
        return true
    }
}

final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options: UIScene.ConnectionOptions) {
        guard let scene = scene as? UIWindowScene else { return }
        let window = UIWindow(windowScene: scene)
        window.rootViewController = WebViewController()
        window.makeKeyAndVisible()
        self.window = window
    }
}

final class WebViewController: UIViewController, WKNavigationDelegate {
    private var webView: WKWebView!
    private let exporter = ExportFile()
    private let route = AudioRoute()

    override func loadView() {
        let cfg = WKWebViewConfiguration()
        cfg.setURLSchemeHandler(LocalScheme(), forURLScheme: LocalScheme.scheme)
        cfg.allowsInlineMediaPlayback = true
        cfg.mediaTypesRequiringUserActionForPlayback = []
        cfg.websiteDataStore = .default()   // localStorage (settings, history) survives relaunches
        // no text selection / loupe: a resting finger (a hold) would otherwise start one, which cancels the touch
        cfg.preferences.isTextInteractionEnabled = false
        exporter.presenter = self
        cfg.userContentController.add(exporter, name: "exportFile")
        cfg.userContentController.add(route, name: "audioRoute")

        #if DEBUG
        DebugHooks.install(cfg)
        #endif
        webView = WKWebView(frame: .zero, configuration: cfg)
        webView.isInspectable = true        // Safari ▸ Develop on the Mac can attach
        webView.navigationDelegate = self
        route.webView = webView
        webView.isOpaque = false
        webView.backgroundColor = UIColor(named: "LaunchBackground")
        webView.scrollView.backgroundColor = webView.backgroundColor
        webView.scrollView.contentInsetAdjustmentBehavior = .never   // the page handles safe areas itself
        webView.scrollView.bounces = false
        view = webView
        webView.load(URLRequest(url: LocalScheme.home))
    }

    // keep the home bar and edge swipes from firing during play
    override var prefersHomeIndicatorAutoHidden: Bool { true }
    override var preferredScreenEdgesDeferringSystemGestures: UIRectEdge { .all }
    override var prefersStatusBarHidden: Bool { true }

    #if DEBUG
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        DebugHooks.runTest(in: webView)
    }
    #endif

    // the web content process can be killed in the background; reload instead of showing a blank page
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        webView.load(URLRequest(url: LocalScheme.home))
    }
}
