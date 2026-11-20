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

export function owningStage(item: any, stages: any[]): string | undefined {
  const assigned: string[] = item?.config?.stage_ids || [];
  return stages.find(stage => !assigned.length || assigned.includes(stage.id))?.id;
}

export function lockedStageSteps(schema: any, selectedStageIds: string[], makeSteps: (fields: any[], groups: any[]) => any[]) {
  const stages = (schema?.stages || []).filter((stage: any) => stage.status === "ACTIVE" && selectedStageIds.includes(stage.id)).sort((a: any, b: any) => a.position - b.position);
  return stages.map((stage: any) => {
    const fields = (schema?.fields || []).filter((field: any) => owningStage(field, stages) === stage.id);
    const groups = (schema?.repeating_groups || []).filter((group: any) => owningStage(group, stages) === stage.id);
    const positions = new Map(fields.map((field: any) => [field.id, Number(field.position)]));
    const position = (item: any) => item.kind === "field" ? Number(item.value.position) : Number(positions.get(item.value.config?.questionnaire_after_field_id) ?? item.value.config?.questionnaire_after_position ?? Number.POSITIVE_INFINITY);
    const items = makeSteps(fields, groups).flatMap(step => step.items).sort((a: any, b: any) => position(a) - position(b) || (a.kind === b.kind ? Number(a.value.position) - Number(b.value.position) : a.kind === "field" ? -1 : 1));
    return { name: stage.name, stageId: stage.id, fields, groups, items };
  });
}
