export function stageApplies(item: any, selectedStageIds: string[], hasStages: boolean): boolean {
  if (!hasStages) return true;
  const assigned: string[] = item?.config?.stage_ids || item?.locator?.stage_ids || [];
  return assigned.length === 0 || assigned.some(id => selectedStageIds.includes(id));
}

export function selectedQuestionnaire(schema: any, selectedStageIds: string[]) {
  const hasStages = (schema?.stages || []).length > 0;
  return {
    fields: (schema?.fields || []).filter((field: any) => stageApplies(field, selectedStageIds, hasStages)),
    groups: (schema?.repeating_groups || []).filter((group: any) => stageApplies(group, selectedStageIds, hasStages)),
  };
}
