"""Domain router for the single user-facing contract selection workflow."""
from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass(frozen=True)
class ContractRoute:
    domain: str
    needs_clarification: bool = False


class ContractRouter:
    """Select an internal rules engine without exposing engine choice to the UI."""

    _training = re.compile(r'\b(тренер\w*|трениров\w*|спортивн\w*\s+(?:заняти\w*|подготовк\w*))\b', re.I)
    _possible_training = re.compile(r'\b(заняти\w*|фитнес\w*|физическ\w*\s+подготовк\w*)\b', re.I)

    def route(self, text: str, context: dict | None = None) -> ContractRoute:
        context=context or {}
        if context.get('contract_domain')=='training': return ContractRoute('training')
        if context.get('pending_contract_domain')=='training':
            normalized=' '.join(text.lower().replace('ё','е').split())
            if normalized in {'да','верно','правильно','да, верно','подтверждаю'}: return ContractRoute('training')
            if normalized in {'нет','неверно','нет, не тренировки'}: return ContractRoute('generic')
            return ContractRoute('unknown',True)
        if self._training.search(text): return ContractRoute('training')
        if self._possible_training.search(text): return ContractRoute('unknown',True)
        return ContractRoute('generic')


contract_router=ContractRouter()
