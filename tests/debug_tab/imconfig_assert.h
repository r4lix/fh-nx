#include <cstdio>
#include <cstdlib>
#define IM_ASSERT(e) do { if (!(e)) { std::fprintf(stderr, "IM_ASSERT failed: %s (%s:%d)\n", #e, __FILE__, __LINE__); std::abort(); } } while (0)
