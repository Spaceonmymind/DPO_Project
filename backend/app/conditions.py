"""Validated declarative conditions for contract questionnaires."""
from __future__ import annotations

from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Any


class ConditionConfigurationError(ValueError):
    pass


class ConditionEngine:
    COMPARISONS = {
        "EQUALS", "NOT_EQUALS", "IN", "NOT_IN", "IS_EMPTY", "IS_NOT_EMPTY",
        "GREATER_THAN", "LESS_THAN", "GREATER_OR_EQUAL", "LESS_OR_EQUAL",
    }
    ORDERED_TYPES = {"INTEGER", "DECIMAL", "MONEY", "DATE"}
    MAX_DEPTH = 8
    MAX_NODES = 100
    MAX_LIST_VALUES = 100

    @classmethod
    def validate_schema(cls, fields: list[Any]) -> None:
        by_key = {field.field_key: field for field in fields}
        if len(by_key) != len(fields):
            raise ConditionConfigurationError("Ключи полей анкеты должны быть уникальны")
        graph: dict[str, set[str]] = {key: set() for key in by_key}
        for field in fields:
            config = field.config or {}
            for name in ("visible_when", "required_when"):
                condition = config.get(name)
                if condition is not None:
                    refs: set[str] = set()
                    cls._validate_node(condition, by_key, refs, 1, [0])
                    graph[field.field_key].update(refs)
        cls._validate_acyclic(graph)

    @classmethod
    def validate_condition(cls, condition: dict[str, Any], fields: list[Any]) -> set[str]:
        """Validate one reusable rule against stable questionnaire field keys."""
        by_key = {field.field_key: field for field in fields}
        refs: set[str] = set()
        cls._validate_node(condition, by_key, refs, 1, [0])
        return refs

    @classmethod
    def evaluate(cls, condition: dict[str, Any] | None, answers: dict[str, Any]) -> bool:
        if condition is None:
            return True
        operator = condition["operator"]
        if operator == "AND":
            return all(cls.evaluate(item, answers) for item in condition["conditions"])
        if operator == "OR":
            return any(cls.evaluate(item, answers) for item in condition["conditions"])
        if operator == "NOT":
            return not cls.evaluate(condition["condition"], answers)
        actual = answers.get(condition["field_key"])
        if operator == "IS_EMPTY":
            return cls._empty(actual)
        if operator == "IS_NOT_EMPTY":
            return not cls._empty(actual)
        expected = condition["value"]
        if operator == "EQUALS": return cls._equal(actual, expected)
        if operator == "NOT_EQUALS": return not cls._equal(actual, expected)
        if operator == "IN": return any(cls._equal(actual, item) for item in expected)
        if operator == "NOT_IN": return not any(cls._equal(actual, item) for item in expected)
        if cls._empty(actual): return False
        left, right = cls._ordered(actual), cls._ordered(expected)
        if operator == "GREATER_THAN": return left > right
        if operator == "LESS_THAN": return left < right
        if operator == "GREATER_OR_EQUAL": return left >= right
        if operator == "LESS_OR_EQUAL": return left <= right
        raise ConditionConfigurationError(f"Неизвестный оператор {operator}")

    @classmethod
    def field_state(cls, field: Any, answers: dict[str, Any]) -> dict[str, bool]:
        config = field.config or {}
        visible = cls.evaluate(config.get("visible_when"), answers)
        required = visible and (bool(field.required) or (
            config.get("required_when") is not None
            and cls.evaluate(config["required_when"], answers)
        ))
        return {"visible": visible, "required": required}

    @classmethod
    def active_fields(cls, fields: list[Any], answers: dict[str, Any]) -> list[Any]:
        return [field for field in fields if cls.field_state(field, answers)["visible"]]

    @classmethod
    def _validate_node(cls, node: Any, fields: dict[str, Any], refs: set[str], depth: int, count: list[int]) -> None:
        count[0] += 1
        if count[0] > cls.MAX_NODES:
            raise ConditionConfigurationError(f"Условие содержит больше {cls.MAX_NODES} элементов")
        if depth > cls.MAX_DEPTH:
            raise ConditionConfigurationError(f"Глубина условия превышает {cls.MAX_DEPTH}")
        if not isinstance(node, dict) or not isinstance(node.get("operator"), str):
            raise ConditionConfigurationError("Каждое условие должно быть объектом с оператором")
        operator = node["operator"]
        if operator in {"AND", "OR"}:
            cls._keys(node, {"operator", "conditions"})
            children = node.get("conditions")
            if not isinstance(children, list) or len(children) < 2:
                raise ConditionConfigurationError(f"{operator} должен содержать минимум два условия")
            for child in children:
                cls._validate_node(child, fields, refs, depth + 1, count)
            return
        if operator == "NOT":
            cls._keys(node, {"operator", "condition"})
            cls._validate_node(node.get("condition"), fields, refs, depth + 1, count)
            return
        if operator not in cls.COMPARISONS:
            raise ConditionConfigurationError(f"Оператор {operator} не поддерживается")
        allowed = {"operator", "field_key"} if operator in {"IS_EMPTY", "IS_NOT_EMPTY"} else {"operator", "field_key", "value"}
        cls._keys(node, allowed)
        key = node.get("field_key")
        if not isinstance(key, str) or key not in fields:
            raise ConditionConfigurationError(f"Поле зависимости «{key}» не найдено")
        refs.add(key)
        field = fields[key]
        if operator in {"GREATER_THAN", "LESS_THAN", "GREATER_OR_EQUAL", "LESS_OR_EQUAL"} and field.field_type not in cls.ORDERED_TYPES:
            raise ConditionConfigurationError(f"Оператор {operator} несовместим с типом {field.field_type}")
        if operator in {"IS_EMPTY", "IS_NOT_EMPTY"}:
            return
        value = node.get("value")
        if operator in {"IN", "NOT_IN"}:
            if not isinstance(value, list) or not value or len(value) > cls.MAX_LIST_VALUES:
                raise ConditionConfigurationError(f"{operator} требует непустой список до {cls.MAX_LIST_VALUES} значений")
            for item in value: cls._validate_value(field, item)
        else:
            cls._validate_value(field, value)

    @staticmethod
    def _keys(node: dict[str, Any], allowed: set[str]) -> None:
        unknown = set(node) - allowed
        missing = allowed - set(node)
        if unknown or missing:
            raise ConditionConfigurationError("Некорректная структура условия")

    @classmethod
    def _validate_value(cls, field: Any, value: Any) -> None:
        kind = field.field_type
        valid = False
        if kind in {"TEXT", "MULTILINE_TEXT", "DATE", "SINGLE_SELECT"}:
            valid = isinstance(value, str)
            if valid and kind == "DATE":
                try: date.fromisoformat(value)
                except ValueError: valid = False
            if valid and kind == "SINGLE_SELECT" and value not in (field.config or {}).get("options", []): valid = False
        elif kind == "BOOLEAN": valid = isinstance(value, bool)
        elif kind == "INTEGER": valid = isinstance(value, int) and not isinstance(value, bool)
        elif kind in {"DECIMAL", "MONEY"}:
            valid = isinstance(value, (int, float)) and not isinstance(value, bool)
        if not valid:
            raise ConditionConfigurationError(f"Значение условия несовместимо с полем «{field.field_key}»")

    @staticmethod
    def _validate_acyclic(graph: dict[str, set[str]]) -> None:
        visiting: set[str] = set()
        visited: set[str] = set()
        def visit(key: str) -> None:
            if key in visiting: raise ConditionConfigurationError(f"Обнаружена циклическая зависимость у поля «{key}»")
            if key in visited: return
            visiting.add(key)
            for dependency in graph[key]: visit(dependency)
            visiting.remove(key); visited.add(key)
        for key in graph: visit(key)

    @staticmethod
    def _empty(value: Any) -> bool:
        return value is None or value == "" or value == []

    @staticmethod
    def _ordered(value: Any) -> Decimal | date:
        if isinstance(value, str):
            try: return date.fromisoformat(value)
            except ValueError: pass
        try: return Decimal(str(value))
        except (InvalidOperation, ValueError, TypeError):
            raise ConditionConfigurationError("Значение нельзя сравнить по порядку")

    @staticmethod
    def _equal(actual: Any, expected: Any) -> bool:
        if isinstance(expected, (int, float)) and not isinstance(expected, bool):
            try: return Decimal(str(actual)) == Decimal(str(expected))
            except (InvalidOperation, ValueError, TypeError): return False
        return actual == expected
