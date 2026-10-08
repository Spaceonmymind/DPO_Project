import argparse
from app.cli.common import run
from app.db import User


def main():
    parser = argparse.ArgumentParser(description='Изменить данные пользователя')
    parser.add_argument('--username', required=True)
    parser.add_argument('--full-name')
    parser.add_argument('--email')
    parser.add_argument('--department')
    parser.add_argument('--enable', action='store_true')
    args = parser.parse_args()
    def update(db):
        user = db.query(User).filter_by(external_id=args.username.strip().lower()).first()
        if not user: raise SystemExit('Пользователь не найден')
        if args.full_name: user.full_name = args.full_name.strip()
        if args.email: user.email = args.email.strip()
        if args.department: user.department = args.department.strip()
        if args.enable: user.is_active = True
        print(f'Пользователь {user.external_id} обновлён')
    run(update)


if __name__ == '__main__': main()
