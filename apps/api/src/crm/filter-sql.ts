import { sql, type SQL } from 'drizzle-orm';
import type { FilterCondition, FilterKind } from '@relay-desk/domain';

/**
 * Where a filterable value lives: a typed column, or a key in a JSONB custom_fields
 * column. Mirrors `matchesConditions` in the domain package.
 */
export type FilterTarget =
  | { source: 'column'; expr: SQL; kind: FilterKind }
  | { source: 'json'; column: SQL; fieldId: string; kind: FilterKind };

function likeEscape(v: string): string {
  return `%${v.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
}

export function conditionToSql(target: FilterTarget, c: FilterCondition): SQL {
  const kind = target.kind;
  const v = c.value;
  // Scalar text form of the value (JSON ->> or the column itself).
  const scalar: SQL = target.source === 'json' ? sql`(${target.column} ->> ${target.fieldId})` : sql`(${target.expr})`;
  const jsonValue: SQL | null = target.source === 'json' ? sql`(${target.column} -> ${target.fieldId})` : null;

  if (kind === 'text_list' || kind === 'email_list' || kind === 'phone_list') {
    if (target.source !== 'column') throw new Error('List filters apply to array columns');
    const arr = target.expr;
    switch (c.op) {
      case 'empty':
        return sql`coalesce(cardinality(${arr}), 0) = 0`;
      case 'not_empty':
        return sql`coalesce(cardinality(${arr}), 0) > 0`;
      case 'is':
        return sql`exists (select 1 from unnest(${arr}) x where lower(x) = lower(${String(v)}))`;
      case 'is_not':
        return sql`not exists (select 1 from unnest(${arr}) x where lower(x) = lower(${String(v)}))`;
      case 'contains':
        return kind === 'phone_list'
          ? sql`exists (select 1 from unnest(${arr}) x where regexp_replace(x, '\\D', '', 'g') like ${likeEscape(String(v))})`
          : sql`exists (select 1 from unnest(${arr}) x where x ilike ${likeEscape(String(v))})`;
      default:
        throw new Error(`Unsupported op ${c.op}`);
    }
  }

  if (kind === 'option_list') {
    const jv = jsonValue ?? sql`to_jsonb(${scalar})`;
    switch (c.op) {
      case 'empty':
        return sql`coalesce(jsonb_array_length(case when jsonb_typeof(${jv}) = 'array' then ${jv} end), 0) = 0`;
      case 'not_empty':
        return sql`coalesce(jsonb_array_length(case when jsonb_typeof(${jv}) = 'array' then ${jv} end), 0) > 0`;
      case 'is':
        return sql`coalesce(${jv} ? ${String(v)}, false)`;
      case 'is_not':
        return sql`not coalesce(${jv} ? ${String(v)}, false)`;
      default:
        throw new Error(`Unsupported op ${c.op}`);
    }
  }

  if (c.op === 'empty') return sql`(${scalar} is null or ${scalar} = '')`;
  if (c.op === 'not_empty') return sql`(${scalar} is not null and ${scalar} <> '')`;

  switch (kind) {
    case 'text':
    case 'email':
      if (c.op === 'is') return sql`lower(${scalar}) = lower(${String(v)})`;
      if (c.op === 'is_not') return sql`(${scalar} is null or lower(${scalar}) <> lower(${String(v)}))`;
      if (c.op === 'contains') return sql`${scalar} ilike ${likeEscape(String(v))}`;
      break;
    case 'phone':
      if (c.op === 'is') return sql`${scalar} = ${String(v)}`;
      if (c.op === 'is_not') return sql`(${scalar} is null or ${scalar} <> ${String(v)})`;
      if (c.op === 'contains') return sql`regexp_replace(${scalar}, '\\D', '', 'g') like ${likeEscape(String(v))}`;
      break;
    case 'option':
    case 'ref':
      if (c.op === 'is') return sql`${scalar}::text = ${String(v)}`;
      if (c.op === 'is_not') return sql`(${scalar} is null or ${scalar}::text <> ${String(v)})`;
      break;
    case 'number':
      if (c.op === 'is') return sql`(${scalar})::numeric = ${Number(v)}`;
      if (c.op === 'is_not') return sql`(${scalar} is null or (${scalar})::numeric <> ${Number(v)})`;
      break;
    case 'boolean':
      if (c.op === 'is') return sql`(${scalar})::boolean = ${Boolean(v)}`;
      break;
    case 'date':
    case 'datetime': {
      // Compare on the UTC calendar date; "in last N days" on the instant.
      const day =
        target.source === 'json'
          ? sql`substring(${scalar} from 1 for 10)`
          : sql`to_char((${target.expr}) at time zone 'UTC', 'YYYY-MM-DD')`;
      if (c.op === 'is') return sql`${day} = ${String(v)}`;
      if (c.op === 'before') return sql`${day} < ${String(v)}`;
      if (c.op === 'after') return sql`${day} > ${String(v)}`;
      if (c.op === 'in_last_days') {
        const instant = target.source === 'json' ? sql`(${scalar})::timestamptz` : sql`(${target.expr})`;
        return sql`(${instant} >= now() - make_interval(days => ${Number(v)}) and ${instant} <= now())`;
      }
      break;
    }
  }
  throw new Error(`Unsupported filter ${kind}/${c.op}`);
}
