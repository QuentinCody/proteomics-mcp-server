/** Parse positional SDRF cells without collapsing repeated headers or assay rows. */
export function parseSdrf(text: string, dataFile?: string) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r\n|\n|\r/);
  if (lines[lines.length - 1] === "") lines.pop();
  const columns = (lines.shift() ?? "").split("\t");
  if (columns.length > 512 || columns.some(column => !column)) throw new Error("Invalid SDRF header or more than 512 columns");
  const required = ["source name", "comment[data file]"];
  for (const name of required) {
    if (columns.filter(column => column === name).length !== 1) throw new Error(`SDRF requires exactly one '${name}' column`);
  }
  if (lines.length > 20000) throw new Error("SDRF exceeds the local 20,000-row limit");
  const sampleIndex = columns.indexOf("source name");
  const fileIndex = columns.indexOf("comment[data file]");
  const rows = lines.map((line, index) => {
    const cells = line.split("\t");
    if (cells.length !== columns.length) throw new Error(`SDRF line ${index + 2} has ${cells.length} cells; expected ${columns.length}`);
    return { source_line: index + 2, source_name: cells[sampleIndex], data_file: cells[fileIndex], cells_json: JSON.stringify(cells) };
  });
  return {
    columns, rows: dataFile === undefined ? rows : rows.filter(row => row.data_file === dataFile),
    total_rows: rows.length, selected_data_file: dataFile ?? null,
    matching: "Exact case-sensitive data-file equality; no basename, extension, sample-name or USI inference",
    validation: "Positional TSV parsing only; not full SDRF, ontology or deposited-file validation",
  };
}
