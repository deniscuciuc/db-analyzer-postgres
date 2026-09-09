/**
 * Quote a PostgreSQL identifier for safe interpolation into SQL text.
 *
 * Identifiers cannot be passed as bind parameters, so anywhere a schema, table
 * or index name reaches SQL it must be quoted here first. Embedded double
 * quotes are doubled, which is what makes the result injection-safe.
 */
export function quoteIdentifier(name: string): string {
	return `"${name.replace(/"/g, '""')}"`;
}

/** Quote a schema-qualified name, e.g. `public.users` -> `"public"."users"`. */
export function quoteQualifiedName(schema: string, name: string): string {
	return `${quoteIdentifier(schema)}.${quoteIdentifier(name)}`;
}
