__nx.log("[chk] updateEvents patched=" + (String(Game_Map.prototype.updateEvents).indexOf("_alertLock") >= 0) + " events cached=" + (String(Game_Map.prototype.events).indexOf("__evSrc") >= 0));
