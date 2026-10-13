// OS observation only: no app hooks, key retrieval, injected JavaScript or product rebuild.
import AppKit
import CoreGraphics
import Foundation
import ImageIO
import Vision

func emit(_ value: [String: Any]) throws {
    let data = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
    print(String(decoding: data, as: UTF8.self))
}

do {
    guard CommandLine.arguments.count == 3 else { throw NSError(domain: "acceptance", code: 1) }
    let command = CommandLine.arguments[1], argument = CommandLine.arguments[2]
    if command == "ocr" {
        let url = URL(fileURLWithPath: argument)
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
              let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
            throw NSError(domain: "missing native screenshot", code: 2)
        }
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = false
        request.recognitionLanguages = ["en-US", "ko-KR"]
        try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
        let lines = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }
        try emit(["width": image.width, "height": image.height, "lines": lines])
    } else {
        guard let pid = Int32(argument), let app = NSRunningApplication(processIdentifier: pid) else {
            throw NSError(domain: "native app process missing", code: 3)
        }
        if command == "terminate" {
            try emit(["requested": app.terminate()])
        } else if command == "window" {
            _ = app.activate(options: [.activateAllWindows, .activateIgnoringOtherApps])
            let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
            let window = windows.first { value in
                guard (value[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == pid,
                      (value[kCGWindowLayer as String] as? Int) == 0,
                      let bounds = value[kCGWindowBounds as String] as? [String: Any],
                      let width = bounds["Width"] as? NSNumber, let height = bounds["Height"] as? NSNumber else { return false }
                return width.doubleValue >= 400 && height.doubleValue >= 300
            }
            try emit(["windowId": window?[kCGWindowNumber as String] ?? NSNull()])
        } else {
            throw NSError(domain: "unknown native observation", code: 4)
        }
    }
} catch {
    fputs("Native observation failed: \(error)\n", stderr)
    exit(1)
}
