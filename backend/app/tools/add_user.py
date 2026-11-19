"""Add a portal login user, or change a password (admins can also do this in the portal's Admin page).

    python -m app.tools.add_user alice --name "Alice Rao"             (asks for the password, saves it in the database)
    python -m app.tools.add_user alice --role admin                   (makes the user an admin)
    python -m app.tools.add_user alice --sql                          (prints an INSERT to run in pgAdmin instead)
"""

import argparse
import getpass
import sys

from app.core.config import get_settings
from app.core.passwords import hash_password
from app.repositories.database import Database
from app.repositories.user_repository import ROLES, TABLE, PortalUser, PostgresUserRepository


def _quote(text: str) -> str:
    return "'" + text.replace("'", "''") + "'"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Add a portal login user, or change an existing user's password.")
    parser.add_argument("username")
    parser.add_argument("--name", default="", help="display name shown after login")
    parser.add_argument("--role", choices=ROLES, help="admin or user (an existing user keeps the current role if this is left out)")
    parser.add_argument("--sql", action="store_true", help="print the SQL instead of saving to the database")
    parser.add_argument("--disable", action="store_true", help="mark the user inactive (cannot log in)")
    args = parser.parse_args(argv)

    password = getpass.getpass("Password: ")
    if len(password) < 8 or password != getpass.getpass("Repeat password: "):
        print("The password must be at least 8 characters and typed the same twice.", file=sys.stderr)
        return 1
    user = PortalUser(args.username.strip(), hash_password(password), args.name.strip(), not args.disable, args.role or "user")

    if args.sql:
        print(
            f"INSERT INTO {TABLE} (username, password_hash, full_name, is_active, role) VALUES "
            f"({_quote(user.username)}, {_quote(user.password_hash)}, {_quote(user.full_name)}, {str(user.is_active).lower()}, {_quote(user.role)})\n"
            f"ON CONFLICT (lower(username)) DO UPDATE SET password_hash = EXCLUDED.password_hash, "
            f"full_name = EXCLUDED.full_name, is_active = EXCLUDED.is_active"
            + (", role = EXCLUDED.role;" if args.role else ";")
        )
        return 0

    repo = PostgresUserRepository(Database(get_settings()))
    repo.ensure_schema()
    existing = repo.get(user.username)
    if existing and not args.role:
        user.role = existing.role
    repo.save(user)
    print(f"Saved user '{user.username}' ({user.role}).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
