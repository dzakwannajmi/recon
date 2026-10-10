import { it } from "vitest";
import { IS_TEST, packageSpecifiers, reachable, realGraph } from "../testing/import-graph";
it("p", () => {
  const g = realGraph();
  const roots = [...g.index.values()].filter((f) => f.startsWith("app/api/mcp/") && !IS_TEST.test(f));
  const set = reachable(roots, g);
  process.stderr.write("\n" + JSON.stringify({ roots, files: [...set].sort(), pk: [...packageSpecifiers(set, g)].sort() }, null, 1) + "\n");
});
