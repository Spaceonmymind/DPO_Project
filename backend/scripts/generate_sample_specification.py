from pathlib import Path

from app.documents.service import generate_xlsx


data = {
    'subject': 'Поставка ноутбуков',
    'purpose': 'Оснащение рабочих мест сотрудников',
    'scope': 'Поставка 5 ноутбуков без установки',
    'deadline': '20 рабочих дней',
    'acceptance_criteria': 'Соответствие количеству и заявленным характеристикам',
    'items': [
        {'name': 'Ноутбук Альфа', 'quantity': 3, 'unit': 'шт.', 'characteristics': 'RAM 16 ГБ; SSD 512 ГБ', 'warranty': '24 месяца', 'delivery_address': 'Москва'},
        {'name': 'Ноутбук Бета', 'quantity': 2, 'unit': 'шт.', 'characteristics': 'RAM 32 ГБ; SSD 1 ТБ', 'warranty': '36 месяцев', 'delivery_address': 'Москва'},
    ],
    'common_requirements': ['Только поставка, без установки'],
    'blocking_requirements': ['Не допускается восстановленное оборудование'],
    'additional_conditions': ['Упаковка должна обеспечивать сохранность при транспортировке'],
}

target = Path(__file__).resolve().parents[2] / 'docs' / 'samples' / 'sample_specification.xlsx'
target.parent.mkdir(parents=True, exist_ok=True)
generate_xlsx(data, target)
print(target)
