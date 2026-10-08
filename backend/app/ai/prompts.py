from pathlib import Path
class PromptManager:
    def __init__(self): self.root=Path(__file__).parent/'prompt_templates'
    def load(self,name):
        text=(self.root/f'{name}.md').read_text(encoding='utf-8')
        first,*rest=text.splitlines(); version=first.removeprefix('<!-- version:').removesuffix('-->').strip() if first.startswith('<!-- version:') else '1.0'
        return '\n'.join(rest if first.startswith('<!-- version:') else [first,*rest]),version
