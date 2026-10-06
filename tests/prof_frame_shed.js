// Force load shedding on (budget 1 ms) and run the steady-state frame profile.
globalThis.__perfBudgetMs = 1;
__nx.loadScript("tests/prof_frame.js");
