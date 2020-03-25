#ifndef DISPLAY
#define DISPLAY

#include "nbind/api.h"

namespace DisplayInfo {
  class Display {
    private:
      long left;
      long top;

      long width;
      long height;

    public:
      Display(long left, long top, long width, long height);
      
      long getLeft();
      long getTop();
      
      long getWidth();
      long getHeight();

      static std::vector<Display> getDisplays();
  };
}

#endif
