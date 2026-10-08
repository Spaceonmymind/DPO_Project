import argparse
from app.cli.common import run
from app.db import Session, User


def main():
    parser = argparse.ArgumentParser(description='Отключить локального пользователя')
    parser.add_argument('--username', required=True)
    args = parser.parse_args()
    def disable(db):
        user = db.query(User).filter_by(external_id=args.username.strip().lower()).first()
        if not user: raise SystemExit('Пользователь не найден')
        user.is_active = False
        db.query(Session).filter_by(user_id=user.id).delete()
        print(f'Пользователь {user.external_id} отключён, активные сессии удалены')
    run(disable)


if __name__ == '__main__': main()
