import hashlib
import os
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy.orm import Session

from app.db import ContractRule, ContractTemplate, now, settings


@dataclass(frozen=True)
class ApprovedTemplate:
    code: str
    title: str
    description: str
    filename: str
    file_format: str
    checksum_sha256: str
    version: str = 'test-2026-10'


APPROVED_TEMPLATES = (
    ApprovedTemplate('SUPPLY', 'Договор поставки', 'Для приобретения и передачи товаров без самостоятельного комплекса работ или агентских действий.', 'договор поставки.rtf', 'rtf', '6956c67f83ee92f8cf3a9c9780a3915ed098756470de9b1c0f3eee067f6aee99'),
    ApprovedTemplate('SERVICES', 'Договор возмездного оказания услуг', 'Для деятельности исполнителя, не создающей самостоятельный материальный результат работ.', 'договор возмездного оказания услуг (образец).docx', 'docx', 'd254f14d9d2e50a87b5678df16d98ad91e927d345773d6c6bec132e568835eb9'),
    ApprovedTemplate('WORKS', 'Договор подряда', 'Для выполнения работ с передачей и приёмкой конкретного результата.', 'Договор_подряда.docx', 'docx', '60f248b00f258a8707ac53c4e3bc013308a6059210d3005499e44f21bc6149b7'),
    ApprovedTemplate('AGENCY', 'Агентский договор', 'Для действий агента по поручению и в интересах принципала за отдельное вознаграждение.', 'Shablon-agentskogo-dogovora.docx', 'docx', '6b877041d3ba09749ec729678619faa394695679f941f1328ad8264f14175c53'),
)


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''): digest.update(chunk)
    return digest.hexdigest()


def validated_files() -> list[tuple[ApprovedTemplate, Path, str]]:
    root = Path(settings.contract_templates_path).resolve()
    dynamic = os.getenv('CONTRACT_TEMPLATE_ALLOW_DYNAMIC_CHECKSUMS', 'false').lower() == 'true' and settings.database_url.startswith('sqlite')
    checked = []
    for definition in APPROVED_TEMPLATES:
        path = (root / definition.filename).resolve()
        if not path.is_relative_to(root) or not path.is_file(): raise RuntimeError(f'{definition.code}: файл шаблона отсутствует: {definition.filename}')
        checksum = file_sha256(path)
        if not dynamic and checksum != definition.checksum_sha256: raise RuntimeError(f'{definition.code}: checksum не совпадает')
        checked.append((definition, path, checksum))
    return checked


def sync_contract_registry(db: Session) -> None:
    checked = validated_files()
    existing = {template.code.upper(): template for template in db.query(ContractTemplate).all()}
    for template in existing.values(): template.active = False
    for definition, path, checksum in checked:
        template = existing.get(definition.code)
        if not template:
            template = ContractTemplate(code=definition.code, name=definition.title, description=definition.description, path=str(path))
            db.add(template); db.flush()
        template.code=definition.code; template.name=definition.title; template.description=definition.description
        template.filename=definition.filename; template.path=str(path); template.file_format=definition.file_format
        template.checksum_sha256=checksum; template.version=definition.version; template.active=True; template.updated_at=now()
        if not template.created_at: template.created_at=now()
        db.query(ContractRule).filter_by(template_id=template.id).delete()
        db.add(ContractRule(template_id=template.id,conditions={'template_code':definition.code}))


def verify_registered_templates(db: Session) -> list[tuple[str, str]]:
    root = Path(settings.contract_templates_path).resolve(); results=[]
    for template in db.query(ContractTemplate).filter_by(active=True).order_by(ContractTemplate.code):
        path=Path(template.path).resolve()
        if not path.is_relative_to(root) or not path.is_file(): raise RuntimeError(f'{template.code}: файл отсутствует')
        checksum=file_sha256(path)
        if checksum != template.checksum_sha256: raise RuntimeError(f'{template.code}: checksum не совпадает')
        results.append((template.code,checksum))
    expected={item.code for item in APPROVED_TEMPLATES}
    if {code for code,_ in results} != expected: raise RuntimeError('Набор активных шаблонов не соответствует утверждённому registry')
    return results
