import type { Pool } from "pg";

/**
 * Makes each `customer_events` insert whose row matches `condition`, a SQL
 * boolean over `new`, fail until the returned cleanup runs.
 */
export const rejectCustomerEventInserts = async (
  pool: Pool,
  condition: string
): Promise<() => Promise<void>> => {
  const trigger = `reject_customer_event_${crypto.randomUUID().replaceAll("-", "")}`;
  await pool.query(
    `create function ${trigger}() returns trigger language plpgsql as $$
     begin
       if ${condition} then
         raise exception 'forced customer event failure';
       end if;
       return new;
     end $$`
  );
  try {
    await pool.query(
      `create trigger ${trigger} before insert on customer_events
       for each row execute function ${trigger}()`
    );
  } catch (error) {
    await pool.query(`drop function ${trigger}()`);
    throw error;
  }
  return async () => {
    await pool.query(`drop trigger if exists ${trigger} on customer_events`);
    await pool.query(`drop function if exists ${trigger}()`);
  };
};
