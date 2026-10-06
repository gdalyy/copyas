// macOS: put text/html and plain text on the general pasteboard.
// Run as: osascript -l JavaScript clip.jxa.js   with {"html":...,"text":...} on stdin.
// The pasteboard server keeps the content, so no process needs to stay alive.
ObjC.import('Foundation')
ObjC.import('AppKit')

function run() {
  const data = $.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile
  const json = $.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding).js
  const payload = JSON.parse(json)
  const pb = $.NSPasteboard.generalPasteboard
  pb.clearContents
  const okHtml = pb.setStringForType($(payload.html || ''), 'public.html')
  const okText = pb.setStringForType($(payload.text || ''), 'public.utf8-plain-text')
  if (!okHtml || !okText) throw new Error('the pasteboard refused the write')
  return 'ready'
}
