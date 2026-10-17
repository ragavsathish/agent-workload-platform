import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const verdictFromScore = (score) => ({ 0: "incorrect", 0.5: "uncertain", 1: "correct" })[score];

const summarizeRows = (rows) => {
  const reviewedRows = rows.filter((row) => ["correct", "uncertain", "incorrect"].includes(row.humanVerdict));
  const judgedRows = reviewedRows.filter((row) => !row.notJudged && row.judgeVerdict);
  const agreements = judgedRows.filter((row) => row.judgeVerdict === row.humanVerdict).length;
  return {
    total: rows.length,
    reviewed: reviewedRows.length,
    unreviewed: rows.length - reviewedRows.length,
    judged: judgedRows.length,
    notJudged: rows.filter((row) => row.notJudged).length,
    agreements,
    agreementRate: judgedRows.length ? agreements / judgedRows.length : null,
  };
};

export function summarizeJudgeResults(document) {
  const rawRows = document?.results?.results;
  if (!Array.isArray(rawRows)) throw new Error("Promptfoo result JSON has no results.results array");
  const rows = rawRows.map((row) => {
    const component = row.gradingResult?.componentResults?.find(
      (candidate) => candidate.assertion?.metric === "selene_judge",
    );
    const notJudged = !component || component.metadata?.graderError === true;
    return {
      description: row.testCase?.description,
      goldCase: row.metadata?.goldCase,
      split: row.metadata?.split || "unspecified",
      humanVerdict: row.metadata?.humanVerdict || "unreviewed",
      judgeVerdict: notJudged ? null : verdictFromScore(component.score),
      notJudged,
      reason: component?.reason || "Missing Selene judge result",
    };
  });
  const splits = Object.fromEntries(
    Object.entries(Object.groupBy(rows, (row) => row.split))
      .map(([split, splitRows]) => [split, summarizeRows(splitRows)]),
  );
  return { overall: summarizeRows(rows), splits, rows: rows.filter((row) => row.notJudged) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const resultPath = process.argv.slice(2).find((argument) => argument !== "--");
  if (!resultPath) throw new Error("Usage: node summarize-judge-results.mjs <promptfoo-results.json>");
  const summary = summarizeJudgeResults(JSON.parse(readFileSync(resultPath, "utf8")));
  console.log(JSON.stringify(summary, null, 2));
}
