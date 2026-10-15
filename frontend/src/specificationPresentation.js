export const SpecificationPresentation=Object.freeze({SUPPLY:'SUPPLY',LEGACY:'LEGACY',NONE:'NONE'});

export function getSupplySpecification(caseData){
  if(caseData?.supply_specification)return caseData.supply_specification;
  return caseData?.technical_specification?.data?.kind==='SUPPLY'?caseData.technical_specification:null;
}

export function getSpecificationPresentation(caseData){
  const context=caseData?.procurement_context||caseData?.context||{};
  if(getSupplySpecification(caseData)||context.procurement_type==='SUPPLY'||context.workflow_type==='SUPPLY_SPECIFICATION'){
    return SpecificationPresentation.SUPPLY;
  }
  return caseData?.technical_specification?SpecificationPresentation.LEGACY:SpecificationPresentation.NONE;
}
