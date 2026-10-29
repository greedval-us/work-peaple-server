// Runs after schema migrations, never during API startup.
// The durable marker prevents recreating admin/admin after a login/password change.
export async function seedInitialAccess(client, options = {}) {
  await client.query('BEGIN');
  try {
    await client.query('SELECT pg_advisory_xact_lock($1)', [1464873041]);
    const marker = await client.query('SELECT key FROM bootstrap_state WHERE key = $1', ['initial_admin_v1']);
    if (marker.rows.length > 0) {
      await client.query('COMMIT');
      return { created: false };
    }

    const role = await client.query("SELECT id FROM roles WHERE code = 'admin' AND is_system = true");
    if (!role.rows[0]) throw new Error('System admin role is missing after migrations');

    const existing = await client.query("SELECT id FROM users WHERE login = 'admin'");
    let userId = existing.rows[0]?.id;
    let created = false;
    if (!userId) {
      const hash = options.hashPassword ?? (await import('../dist/modules/auth/password.js')).hashPassword;
      const passwordHash = await hash('admin');
      const inserted = await client.query(
        "INSERT INTO users (login, password_hash, first_name) VALUES ('admin', $1, 'Администратор') RETURNING id",
        [passwordHash],
      );
      userId = inserted.rows[0].id;
      created = true;
    }
    await client.query(
      'INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [userId, role.rows[0].id],
    );
    await client.query('INSERT INTO bootstrap_state (key) VALUES ($1)', ['initial_admin_v1']);
    await client.query('COMMIT');
    return { created };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
