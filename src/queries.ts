export const QUERIES = {
	// Database size and general metrics
	databaseMetrics: `
    SELECT
      pg_database.datname as database_name,
      pg_size_pretty(pg_database_size(pg_database.datname)) as database_size,
      pg_database_size(pg_database.datname) as database_size_bytes,
      (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()) as total_connections,
      (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND state = 'active') as active_connections,
      (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND state = 'idle') as idle_connections
    FROM pg_database
    WHERE datname = current_database()
  `,

	// Cache hit ratio
	cacheHitRatio: `
    SELECT
      ROUND(
        CASE
          WHEN (sum(heap_blks_hit) + sum(heap_blks_read)) = 0 THEN 0
          ELSE sum(heap_blks_hit) * 100.0 / (sum(heap_blks_hit) + sum(heap_blks_read))
        END, 2
      ) as cache_hit_ratio
    FROM pg_statio_user_tables
    WHERE 1 = 1
      /* schema_filter */
      /* table_filter */
  `,

	// Index hit ratio
	indexHitRatio: `
    SELECT
      ROUND(
        CASE
          WHEN (sum(idx_blks_hit) + sum(idx_blks_read)) = 0 THEN 0
          ELSE sum(idx_blks_hit) * 100.0 / (sum(idx_blks_hit) + sum(idx_blks_read))
        END, 2
      ) as index_hit_ratio
    FROM pg_statio_user_indexes
    WHERE 1 = 1
      /* schema_filter */
      /* table_filter */
  `,

	// Dead tuples ratio
	deadTuplesRatio: `
    SELECT
      ROUND(
        CASE
          WHEN sum(n_live_tup) = 0 THEN 0
          ELSE sum(n_dead_tup) * 100.0 / sum(n_live_tup)
        END, 2
      ) as dead_tuples_ratio
    FROM pg_stat_user_tables
    WHERE 1 = 1
      /* schema_filter */
      /* table_filter */
  `,

	// All indexes with usage statistics
	allIndexes: `
    SELECT
      schemaname as schema,
      relname as table,
      indexrelname as index,
      pg_size_pretty(pg_relation_size(indexrelid)) as size,
      pg_relation_size(indexrelid) as size_bytes,
      idx_scan as index_scans,
      idx_tup_read as tuples_read,
      idx_tup_fetch as tuples_fetched
    FROM pg_stat_user_indexes
    WHERE 1 = 1
      /* schema_filter */
      /* table_filter */
    ORDER BY pg_relation_size(indexrelid) DESC
  `,

	// Unused indexes (indexes with very few or no scans)
	unusedIndexes: `
    SELECT
      s.schemaname as schema,
      s.relname as table,
      s.indexrelname as index,
      i.indisunique as is_unique,
      i.indisprimary as is_primary,
      pg_size_pretty(pg_relation_size(s.indexrelid)) as size,
      pg_relation_size(s.indexrelid) as size_bytes,
      s.idx_scan as index_scans,
      pg_get_indexdef(s.indexrelid) as index_definition,
      CASE
        WHEN s.idx_scan = 0 THEN 'Never used'
        WHEN s.idx_scan < 50 THEN 'Rarely used'
        ELSE 'Low usage'
      END as usage_status
    FROM pg_stat_user_indexes s
    JOIN pg_index i ON s.indexrelid = i.indexrelid
    WHERE s.idx_scan < $1
      AND NOT i.indisunique
      AND NOT i.indisprimary
      AND s.schemaname NOT IN ('pg_catalog', 'information_schema')
      /* schema_filter */
      /* table_filter */
    ORDER BY pg_relation_size(s.indexrelid) DESC
  `,

	// Missing indexes - tables with high sequential scans
	missingIndexes: `
    SELECT
      schemaname as schema,
      relname as table,
      seq_scan as seq_scans,
      seq_tup_read as seq_tup_read,
      idx_scan as idx_scans,
      n_live_tup as row_count,
      pg_size_pretty(pg_relation_size(relid)) as table_size,
      CASE
        WHEN seq_scan > 0 AND idx_scan > 0 THEN
          ROUND((seq_scan::numeric / (seq_scan + idx_scan)) * 100, 2)
        WHEN seq_scan > 0 THEN 100
        ELSE 0
      END as seq_scan_ratio,
      CASE
        WHEN n_live_tup > 10000 AND seq_scan > 100 THEN 'High priority'
        WHEN n_live_tup > 1000 AND seq_scan > 50 THEN 'Medium priority'
        ELSE 'Low priority'
      END as priority
    FROM pg_stat_user_tables
    WHERE seq_scan > $1
      AND n_live_tup > 100
      AND schemaname NOT IN ('pg_catalog', 'information_schema')
      /* schema_filter */
      /* table_filter */
    ORDER BY seq_tup_read DESC
  `,

	// Duplicate/overlapping indexes
	duplicateIndexes: `
    WITH index_cols AS (
      SELECT
        n.nspname as schema_name,
        t.relname as table_name,
        i.relname as index_name,
        a.attname as column_name,
        array_position(ix.indkey, a.attnum) as position
      FROM pg_index ix
      JOIN pg_class t ON t.oid = ix.indrelid
      JOIN pg_class i ON i.oid = ix.indexrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
      WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
        /* schema_filter */
        /* table_filter */
    ),
    index_definitions AS (
      SELECT
        schema_name,
        table_name,
        index_name,
        string_agg(column_name, ',' ORDER BY position) as columns
      FROM index_cols
      GROUP BY schema_name, table_name, index_name
    )
    SELECT
      a.schema_name as schema,
      a.table_name as "table",
      a.index_name as index1,
      b.index_name as index2,
      a.columns as columns1,
      b.columns as columns2,
      CASE
        WHEN a.columns = b.columns THEN 'Exact duplicate - remove one'
        WHEN a.columns LIKE b.columns || ',%' THEN 'Index2 is prefix of Index1 - consider removing Index2'
        WHEN b.columns LIKE a.columns || ',%' THEN 'Index1 is prefix of Index2 - consider removing Index1'
        ELSE 'Overlapping columns'
      END as recommendation
    FROM index_definitions a
    JOIN index_definitions b ON a.schema_name = b.schema_name
      AND a.table_name = b.table_name
      AND a.index_name < b.index_name
      AND (
        a.columns = b.columns
        OR a.columns LIKE b.columns || ',%'
        OR b.columns LIKE a.columns || ',%'
      )
    ORDER BY a.schema_name, a.table_name
  `,

	// Table statistics
	tableStats: `
    SELECT
      schemaname as schema,
      relname as table,
      n_live_tup as row_count,
      pg_size_pretty(pg_total_relation_size(relid)) as total_size,
      pg_total_relation_size(relid) as total_size_bytes,
      pg_size_pretty(pg_relation_size(relid)) as table_size,
      pg_size_pretty(pg_indexes_size(relid)) as index_size,
      seq_scan as seq_scans,
      idx_scan as idx_scans,
      n_dead_tup as dead_tuples,
      last_vacuum,
      last_autovacuum,
      last_analyze,
      last_autoanalyze,
      CASE
        WHEN n_live_tup > 0 THEN ROUND((n_dead_tup::numeric / n_live_tup) * 100, 2)
        ELSE 0
      END as dead_tuple_ratio
    FROM pg_stat_user_tables
    WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
      /* schema_filter */
      /* table_filter */
    ORDER BY pg_total_relation_size(relid) DESC
  `,

	// Slow queries from pg_stat_statements (requires extension)
	slowQueries: `
    SELECT
      queryid::text as query_id,
      query,
      calls,
      ROUND(total_exec_time::numeric, 2) as total_time_ms,
      ROUND(mean_exec_time::numeric, 2) as mean_time_ms,
      ROUND(min_exec_time::numeric, 2) as min_time_ms,
      ROUND(max_exec_time::numeric, 2) as max_time_ms,
      rows,
      shared_blks_hit,
      shared_blks_read,
      CASE
        WHEN (shared_blks_hit + shared_blks_read) > 0 THEN
          ROUND((shared_blks_hit::numeric / (shared_blks_hit + shared_blks_read)) * 100, 2)
        ELSE 100
      END as cache_hit_ratio
    FROM pg_stat_statements
    WHERE mean_exec_time > $1
      AND query NOT LIKE '%pg_stat%'
      AND query NOT LIKE '%pg_catalog%'
    ORDER BY total_exec_time DESC
    LIMIT $2
  `,

	// All query statistics from pg_stat_statements (ordered by total time)
	allQueryStats: `
    SELECT
      queryid::text as query_id,
      query,
      calls,
      rows,
      ROUND(total_exec_time::numeric, 2) as total_time_ms,
      ROUND(mean_exec_time::numeric, 2) as mean_time_ms,
      ROUND(min_exec_time::numeric, 2) as min_time_ms,
      ROUND(max_exec_time::numeric, 2) as max_time_ms,
      shared_blks_hit,
      shared_blks_read,
      CASE
        WHEN (shared_blks_hit + shared_blks_read) > 0 THEN
          ROUND((shared_blks_hit::numeric / (shared_blks_hit + shared_blks_read)) * 100, 2)
        ELSE 100
      END as cache_hit_ratio
    FROM pg_stat_statements
    WHERE query NOT LIKE '%pg_stat%'
      AND query NOT LIKE '%pg_catalog%'
      AND query NOT LIKE 'BEGIN%'
      AND query NOT LIKE 'COMMIT%'
      AND query NOT LIKE 'ROLLBACK%'
      AND query NOT LIKE 'SET %'
      AND calls > $1
    ORDER BY total_exec_time DESC
    LIMIT $2
  `,

	// Check if pg_stat_statements extension exists
	checkPgStatStatements: `
    SELECT EXISTS (
      SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements'
    ) as exists
  `,

	// Table bloat estimation (simplified, uses dead tuple ratio as proxy)
	tableBloat: `
    SELECT
      schemaname as schema,
      relname as "table",
      pg_size_pretty(pg_total_relation_size(relid)) as table_size,
      pg_total_relation_size(relid) as table_bytes,
      pg_size_pretty(
        CASE
          WHEN n_live_tup > 0 THEN
            (pg_total_relation_size(relid) * n_dead_tup / GREATEST(n_live_tup, 1))::bigint
          ELSE 0
        END
      ) as bloat_size,
      CASE
        WHEN n_live_tup > 0 THEN
          (pg_total_relation_size(relid) * n_dead_tup / GREATEST(n_live_tup, 1))::bigint
        ELSE 0
      END as bloat_size_bytes,
      CASE
        WHEN n_live_tup > 0 THEN
          ROUND((n_dead_tup::numeric / n_live_tup) * 100, 2)
        ELSE 0
      END as bloat_ratio
    FROM pg_stat_user_tables
    WHERE n_dead_tup > 0
      AND schemaname NOT IN ('pg_catalog', 'information_schema')
      /* schema_filter */
      /* table_filter */
    ORDER BY n_dead_tup DESC
    LIMIT 20
  `,

	// Index bloat estimation
	indexBloat: `
    SELECT
      schemaname as schema,
      tablename as table,
      indexname as index,
      pg_size_pretty(pg_relation_size(indexrelid)) as index_size,
      pg_relation_size(indexrelid) as index_size_bytes,
      idx_scan as index_scans
    FROM pg_stat_user_indexes
    JOIN pg_index ON pg_stat_user_indexes.indexrelid = pg_index.indexrelid
    WHERE pg_relation_size(pg_stat_user_indexes.indexrelid) > 1024 * 1024
    ORDER BY pg_relation_size(pg_stat_user_indexes.indexrelid) DESC
    LIMIT 20
  `,

	// Current locks and blocking queries
	locks: `
    SELECT
      blocked_locks.pid AS blocked_pid,
      blocked_activity.usename AS blocked_user,
      blocking_locks.pid AS blocking_pid,
      blocking_activity.usename AS blocking_user,
      blocked_activity.query AS blocked_query,
      blocking_activity.query AS blocking_query,
      blocked_activity.state AS blocked_state,
      now() - blocked_activity.query_start AS blocked_duration
    FROM pg_catalog.pg_locks blocked_locks
    JOIN pg_catalog.pg_stat_activity blocked_activity ON blocked_activity.pid = blocked_locks.pid
    JOIN pg_catalog.pg_locks blocking_locks ON
      blocking_locks.locktype = blocked_locks.locktype
      AND blocking_locks.database IS NOT DISTINCT FROM blocked_locks.database
      AND blocking_locks.relation IS NOT DISTINCT FROM blocked_locks.relation
      AND blocking_locks.page IS NOT DISTINCT FROM blocked_locks.page
      AND blocking_locks.tuple IS NOT DISTINCT FROM blocked_locks.tuple
      AND blocking_locks.virtualxid IS NOT DISTINCT FROM blocked_locks.virtualxid
      AND blocking_locks.transactionid IS NOT DISTINCT FROM blocked_locks.transactionid
      AND blocking_locks.classid IS NOT DISTINCT FROM blocked_locks.classid
      AND blocking_locks.objid IS NOT DISTINCT FROM blocked_locks.objid
      AND blocking_locks.objsubid IS NOT DISTINCT FROM blocked_locks.objsubid
      AND blocking_locks.pid != blocked_locks.pid
    JOIN pg_catalog.pg_stat_activity blocking_activity ON blocking_activity.pid = blocking_locks.pid
    WHERE NOT blocked_locks.granted
  `,

	// Long running queries
	longRunningQueries: `
    SELECT
      pid,
      usename as user,
      datname as database,
      state,
      query,
      now() - query_start AS duration,
      wait_event_type,
      wait_event
    FROM pg_stat_activity
    WHERE state != 'idle'
      AND query NOT LIKE '%pg_stat_activity%'
      AND now() - query_start > interval '1 minute'
    ORDER BY duration DESC
  `,

	// Index usage summary per table
	indexUsageSummary: `
    SELECT
      schemaname as schema,
      relname as table,
      CASE
        WHEN (seq_scan + idx_scan) = 0 THEN 0
        ELSE ROUND((idx_scan::numeric / (seq_scan + idx_scan)) * 100, 2)
      END as index_usage_ratio,
      seq_scan as sequential_scans,
      idx_scan as index_scans,
      n_live_tup as rows,
      pg_size_pretty(pg_relation_size(relid)) as table_size
    FROM pg_stat_user_tables
    WHERE n_live_tup > 0
      /* schema_filter */
      /* table_filter */
    ORDER BY
      CASE
        WHEN (seq_scan + idx_scan) = 0 THEN 0
        ELSE (idx_scan::numeric / (seq_scan + idx_scan))
      END ASC,
      seq_scan DESC
  `,

	// Foreign keys without indexes
	// Checks if FK column is the FIRST column in any index (single or composite)
	// B-tree indexes can be used for leftmost prefix searches
	foreignKeysWithoutIndexes: `
    SELECT
      tc.table_schema as schema,
      tc.table_name as table,
      kcu.column_name as column,
      ccu.table_name as foreign_table,
      ccu.column_name as foreign_column,
      'CREATE INDEX idx_' || tc.table_name || '_' || kcu.column_name ||
        ' ON ' || tc.table_schema || '.' || tc.table_name ||
        ' (' || kcu.column_name || ')' as suggested_index,
      (
        SELECT string_agg(indexname, ', ')
        FROM pg_indexes
        WHERE schemaname = tc.table_schema
          AND tablename = tc.table_name
          AND indexdef LIKE '%' || kcu.column_name || '%'
      ) as partial_coverage_indexes
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name
      AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema NOT IN ('pg_catalog', 'information_schema')
      /* schema_filter */
      /* table_filter */
      AND NOT EXISTS (
        SELECT 1
        FROM pg_indexes
        WHERE schemaname = tc.table_schema
          AND tablename = tc.table_name
          AND (
            -- Single column index: (column_name)
            indexdef LIKE '%(' || kcu.column_name || ')%'
            -- First column in composite index: (column_name, ...)
            OR indexdef LIKE '%(' || kcu.column_name || ',%'
          )
      )
    ORDER BY tc.table_schema, tc.table_name
  `,
};
