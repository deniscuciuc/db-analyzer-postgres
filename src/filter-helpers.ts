export interface SqlFilterOptions {
	query: string;
	values?: unknown[];
	schemas?: string[];
	tables?: string[];
	schemaColumn?: string;
	tableColumn?: string;
}

export function applySqlFilters({
	query,
	values = [],
	schemas,
	tables,
	schemaColumn = "schemaname",
	tableColumn = "relname",
}: SqlFilterOptions): { text: string; values: unknown[] } {
	const params = [...values];
	let text = query;

	if (schemas && schemas.length > 0) {
		const schemaParamIndex = params.push(schemas);
		text = text.replaceAll(
			"/* schema_filter */",
			`AND ${schemaColumn} = ANY($${schemaParamIndex}::text[])`,
		);
	} else {
		text = text.replaceAll("/* schema_filter */", "");
	}

	if (tables && tables.length > 0) {
		const tableParamIndex = params.push(tables);
		text = text.replaceAll(
			"/* table_filter */",
			`AND ${tableColumn} = ANY($${tableParamIndex}::text[])`,
		);
	} else {
		text = text.replaceAll("/* table_filter */", "");
	}

	return { text, values: params };
}
