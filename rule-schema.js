export function normalizeExpression(raw,depth=0,budget={nodes:0}) {
  if(depth>6 || ++budget.nodes>64)throw new Error('Date rules allow up to 6 group levels and 64 conditions.');
  if(!raw || typeof raw!=='object')throw new Error('Invalid date condition.');
  if(raw.source==='schedule')return {source:'schedule'};
  if(typeof raw.listId==='string' && /^[\w-]{1,100}$/.test(raw.listId))return {listId:raw.listId};
  if(!['all','any'].includes(raw.op) || !Array.isArray(raw.children) || !raw.children.length || raw.children.length>32)throw new Error('Each All/Any group needs at least one condition.');
  return {op:raw.op,children:raw.children.map(child=>normalizeExpression(child,depth+1,budget))};
}
export function normalizeConditions(raw) {
  if(raw===undefined || raw===null)return null;
  return {include:normalizeExpression(raw.include),exclude:raw.exclude ? normalizeExpression(raw.exclude) : null};
}
export function expressionListIds(node) {
  if(!node)return [];
  return node.listId ? [node.listId] : (node.children || []).flatMap(expressionListIds);
}
export function checkReferences(conditions,lists) {
  const ids=new Set(lists.map(l=>l.id));
  for(const id of [...expressionListIds(conditions?.include),...expressionListIds(conditions?.exclude)])if(!ids.has(id))throw new Error('A date rule refers to a missing list. Choose another list or restore it from a backup.');
}
export function describeExpression(node,lists) {
  if(!node)return 'None';
  if(node.source==='schedule')return 'Assigned schedule';
  if(node.listId)return lists.find(l=>l.id===node.listId)?.name || 'Missing list';
  return (node.op==='all' ? 'All of [' : 'Any of [')+node.children.map(child=>describeExpression(child,lists)).join('; ')+']';
}
