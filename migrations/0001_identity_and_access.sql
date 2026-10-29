CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  login varchar(64) NOT NULL,
  password_hash text NOT NULL,
  first_name varchar(100) NOT NULL DEFAULT '',
  last_name varchar(100) NOT NULL DEFAULT '',
  middle_name varchar(100) NOT NULL DEFAULT '',
  email varchar(254),
  phone varchar(40),
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz,
  password_changed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_login_format CHECK (login = lower(login) AND login ~ '^[a-z0-9][a-z0-9._-]{2,63}$')
);
CREATE UNIQUE INDEX users_login_unique ON users (lower(login));
CREATE UNIQUE INDEX users_email_unique ON users (lower(email)) WHERE email IS NOT NULL;

CREATE TABLE roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(64) NOT NULL UNIQUE,
  name varchar(100) NOT NULL,
  description varchar(1000) NOT NULL DEFAULT '',
  is_system boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT roles_code_format CHECK (code ~ '^[a-z][a-z0-9._-]{1,63}$')
);

CREATE TABLE permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(100) NOT NULL UNIQUE,
  resource varchar(64) NOT NULL,
  name varchar(150) NOT NULL,
  description varchar(1000) NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_roles (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  assigned_by uuid REFERENCES users(id) ON DELETE SET NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role_id)
);
CREATE INDEX user_roles_role_id_idx ON user_roles (role_id);

CREATE TABLE role_permissions (
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES permissions(id) ON DELETE RESTRICT,
  PRIMARY KEY (role_id, permission_id)
);
CREATE INDEX role_permissions_permission_id_idx ON role_permissions (permission_id);

CREATE TABLE auth_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash char(64) NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CONSTRAINT auth_sessions_expiry CHECK (expires_at > created_at)
);
CREATE INDEX auth_sessions_user_active_idx ON auth_sessions (user_id) WHERE revoked_at IS NULL;
CREATE INDEX auth_sessions_expires_at_idx ON auth_sessions (expires_at);

CREATE TABLE bootstrap_state (
  key text PRIMARY KEY,
  completed_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO roles (code, name, description, is_system)
VALUES ('admin', 'Администратор', 'Полный доступ к управлению системой', true);

INSERT INTO permissions (code, resource, name, description) VALUES
  ('users.read', 'users', 'Просмотр пользователей', 'Просмотр списка учётных записей'),
  ('users.create', 'users', 'Создание пользователей', 'Создание учётных записей без публичной регистрации'),
  ('users.update', 'users', 'Изменение пользователей', 'Изменение профилей, статуса и сброс пароля'),
  ('users.roles.assign', 'users', 'Назначение ролей', 'Назначение пользователям доступных ролей'),
  ('roles.read', 'roles', 'Просмотр ролей', 'Просмотр ролей и назначенных им прав'),
  ('roles.create', 'roles', 'Создание ролей', 'Создание пользовательских ролей'),
  ('roles.update', 'roles', 'Изменение ролей', 'Изменение названия и описания ролей'),
  ('roles.delete', 'roles', 'Удаление ролей', 'Удаление неиспользуемых пользовательских ролей'),
  ('roles.permissions.assign', 'roles', 'Назначение прав', 'Изменение прав пользовательских ролей'),
  ('permissions.read', 'permissions', 'Просмотр прав', 'Просмотр каталога реализованных прав');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p WHERE r.code = 'admin';
