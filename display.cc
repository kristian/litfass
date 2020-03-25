
#include "display.h"
#include "nbind/nbind.h"
#include <windows.h>

using namespace DisplayInfo;

Display::Display(long left, long top, long width, long height) {
  this->left = left;
  this->top = top;

  this->width = width;
  this->height = height;
}

LONG Display::getLeft() {
  return left;
}
LONG Display::getTop() {
  return top;
}

LONG Display::getWidth() {
  return width;
}
LONG Display::getHeight() {
  return height;
}

BOOL CALLBACK MonitorEnumProc(HMONITOR hMonitor, HDC hdcMonitor, LPRECT lprcMonitor, LPARAM dwData) {
  std::vector<Display> *result =  (std::vector<Display> *)dwData;

  result->push_back(Display(lprcMonitor->left, lprcMonitor->top, lprcMonitor->right - lprcMonitor->left, lprcMonitor->bottom - lprcMonitor->top));
  
  return TRUE;
}

std::vector<Display> Display::getDisplays() {
  std::vector<Display> displays;

  EnumDisplayMonitors(NULL, NULL, MonitorEnumProc, (LPARAM)&displays);

  return displays;
}

NBIND_CLASS(Display) {
  method(getDisplays);

  getter(getLeft);
  getter(getTop);

  getter(getWidth);
  getter(getHeight);
}