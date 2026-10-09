from app.cli.common import run
from app.contract_registry import verify_registered_templates


def main():
    def verify(db):
        for code, checksum in verify_registered_templates(db): print(f'{code} OK {checksum}')
    run(verify)


if __name__ == '__main__': main()
