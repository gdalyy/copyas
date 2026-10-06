#!/usr/bin/env python3
"""Own the system clipboard with both text/html and text/plain (GTK 4).

Reads {"html": ..., "text": ...} as JSON on stdin, takes the clipboard, prints
"ready" once it owns it, and exits. A detached child keeps the clipboard
alive until another application takes it over (an X11/Wayland clipboard
lives in its owner process), so the copy survives the session that made it.
"""
import json
import os
import sys

try:
    import gi
    gi.require_version("Gdk", "4.0")
    gi.require_version("Gtk", "4.0")
    from gi.repository import Gdk, GLib, GObject, Gtk  # noqa: E402
except Exception as exc:  # pragma: no cover - reported to the caller
    print(f"gtk4 unavailable: {exc}", file=sys.stderr)
    sys.exit(2)

payload = json.load(sys.stdin)
HTML = payload.get("html", "")
TEXT = payload.get("text", "")

# detach: the parent reports the outcome and exits, the grandchild owns the clipboard
report_r, report_w = os.pipe()
if os.fork() != 0:
    os.close(report_w)
    outcome = os.read(report_r, 4096).decode("utf-8", "replace").strip()
    if outcome == "ready":
        print("ready", flush=True)
        sys.exit(0)
    print(outcome or "clipboard owner ended before taking the clipboard", file=sys.stderr)
    sys.exit(1)
os.close(report_r)
os.setsid()
if os.fork() != 0:
    os._exit(0)
devnull = os.open(os.devnull, os.O_RDWR)
for fd in (0, 1, 2):
    os.dup2(devnull, fd)


def report(message):
    os.write(report_w, message.encode("utf-8"))
    os.close(report_w)

if not Gtk.init_check():
    report("no display")
    sys.exit(2)

display = Gdk.Display.get_default()
if display is None:
    report("no display")
    sys.exit(2)
clipboard = display.get_clipboard()

text_value = GObject.Value(str, TEXT)
provider = Gdk.ContentProvider.new_union([
    Gdk.ContentProvider.new_for_bytes("text/html", GLib.Bytes.new(HTML.encode("utf-8"))),
    Gdk.ContentProvider.new_for_value(text_value),
])
if not clipboard.set_content(provider):
    report("could not take the clipboard")
    sys.exit(1)

loop = GLib.MainLoop()


def on_changed(cb):
    # another application took the clipboard: our content is gone, so leave
    if not cb.is_local():
        loop.quit()


clipboard.connect("changed", on_changed)
report("ready")
loop.run()
