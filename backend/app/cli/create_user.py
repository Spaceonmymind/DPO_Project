import argparse

from app.cli.common import password_prompt, run
from app.db import User
from app.security import hash_password


def main():
    parser = argparse.ArgumentParser(description='Создать локального пользователя')
    parser.add_argument('--username', required=True)
    parser.add_argument('--full-name', required=True)
    parser.add_argument('--email', required=True)
    parser.add_argument('--department', required=True)
    args = parser.parse_args()
    password = password_prompt()

    def create(db):
        username = args.username.strip().lower()
        if db.query(User).filter_by(external_id=username).first():
            raise SystemExit('Пользователь уже существует')
        db.add(User(external_id=username, full_name=args.full_name.strip(), email=args.email.strip(), department=args.department.strip(), roles=['employee'], password=hash_password(password), is_active=True))
        print(f'Пользователь {username} создан')
    run(create)


if __name__ == '__main__':
    main()
