import UIKit
import Capacitor

/// The app's web view. It adds the iCloud save plugin below.
class VoteDexViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(ICloudKVPlugin())
    }
}

/// Saves small pieces of text (the user's state, ballot votes and settings)
/// in iCloud key-value storage, which lives in the user's own iCloud account.
/// Nothing is sent to VoteDex. If iCloud is off, reads return nothing and
/// writes stay on the device.
@objc(ICloudKVPlugin)
public class ICloudKVPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ICloudKVPlugin"
    public let jsName = "ICloudKV"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "get", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "set", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "remove", returnType: CAPPluginReturnPromise)
    ]

    private let kv = NSUbiquitousKeyValueStore.default

    override public func load() {
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(changedElsewhere(_:)),
            name: NSUbiquitousKeyValueStore.didChangeExternallyNotification,
            object: kv
        )
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(cameBack),
            name: UIApplication.willEnterForegroundNotification,
            object: nil
        )
        kv.synchronize()
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    @objc func get(_ call: CAPPluginCall) {
        guard let key = call.getString("key") else { return call.reject("Missing key") }
        kv.synchronize()
        call.resolve(["value": kv.string(forKey: key) ?? NSNull()])
    }

    @objc func set(_ call: CAPPluginCall) {
        guard let key = call.getString("key"), let value = call.getString("value") else {
            return call.reject("Missing key or value")
        }
        kv.set(value, forKey: key)
        kv.synchronize()
        call.resolve()
    }

    @objc func remove(_ call: CAPPluginCall) {
        guard let key = call.getString("key") else { return call.reject("Missing key") }
        kv.removeObject(forKey: key)
        kv.synchronize()
        call.resolve()
    }

    @objc private func cameBack() {
        kv.synchronize()
    }

    /// Another device saved something. Tell the page so it can refresh.
    @objc private func changedElsewhere(_ note: Notification) {
        let keys = note.userInfo?[NSUbiquitousKeyValueStoreChangedKeysKey] as? [String] ?? []
        for key in keys {
            notifyListeners("change", data: ["key": key, "value": kv.string(forKey: key) ?? NSNull()])
        }
    }
}
