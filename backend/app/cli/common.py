import getpass

from app.db import SessionLocal


def password_prompt(confirm: bool = True) -> str:
    password = getpass.getpass('Пароль: ')
    if len(password) < 12:
        raise SystemExit('Пароль должен содержать не менее 12 символов')
    if confirm and password != getpass.getpass('Повторите пароль: '):
        raise SystemExit('Пароли не совпадают')
    return password


def run(action):
    db = SessionLocal()
    try:
        action(db)
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
