#ifdef WIN32

#include "displays.h"
#include <windows.h>

using v8::Local;
using v8::Object;
using v8::Array;
using v8::Number;
using v8::String;
using v8::FunctionTemplate;

NAN_MODULE_INIT(init) {
  Nan::Set(target, Nan::New("get").ToLocalChecked(),
    Nan::GetFunction(Nan::New<FunctionTemplate>(get)).ToLocalChecked());
}

NODE_MODULE(displays, init)

BOOL CALLBACK MonitorEnumProc(HMONITOR hMonitor, HDC hdcMonitor, LPRECT lprcMonitor, LPARAM dwData) {
  v8::Local<v8::Object> display = Nan::New<v8::Object>();
  Nan::Set(display, Nan::New("left").ToLocalChecked(), Nan::New(lprcMonitor->left));
  Nan::Set(display, Nan::New("top").ToLocalChecked(), Nan::New(lprcMonitor->top));
  Nan::Set(display, Nan::New("width").ToLocalChecked(), Nan::New(lprcMonitor->right - lprcMonitor->left));
  Nan::Set(display, Nan::New("height").ToLocalChecked(), Nan::New(lprcMonitor->bottom - lprcMonitor->top));
  
  v8::Local<v8::Array> displays =  *((v8::Local<v8::Array> *)dwData);
  Nan::Set(displays, displays->Length(), display);
  
  return TRUE;
}

NAN_METHOD(get) {
    v8::Local<v8::Array> displays = Nan::New<v8::Array>();

    EnumDisplayMonitors(NULL, NULL, MonitorEnumProc, (LPARAM)&displays);

    info.GetReturnValue().Set(displays);
}

#endif