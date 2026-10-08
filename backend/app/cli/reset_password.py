import argparse
from app.cli.common import password_prompt, run
from app.db import Session, User
from app.security import hash_password


def main():
    parser = argparse.ArgumentParser(description='Сбросить пароль пользователя')
    parser.add_argument('--username', required=True)
    args = parser.parse_args(); password = password_prompt()
    def reset(db):
        user = db.query(User).filter_by(external_id=args.username.strip().lower()).first()
        if not user: raise SystemExit('Пользователь не найден')
        user.password = hash_password(password)
        db.query(Session).filter_by(user_id=user.id).delete()
        print(f'Пароль пользователя {user.external_id} изменён, активные сессии удалены')
    run(reset)


if __name__ == '__main__': main()
