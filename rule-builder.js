import {iconMarkup} from './icons.js';
import {normalizeConditions,expressionListIds,describeExpression} from './rule-schema.js';
export function createRuleBuilder(host,initial,lists,onChange) {
  let enabled=!!initial;
  let conditions=structuredClone(initial || {include:{op:'all',children:[{source:'schedule'}]},exclude:null});
  const firstLeaf=()=>lists.length ? {listId:lists[0].id}:{source:'schedule'};
  function button(label,icon,action) {
    const b=document.createElement('button');b.type='button';b.className='rule-action';b.innerHTML=iconMarkup(icon);b.append(document.createTextNode(label));b.addEventListener('click',action);return b;
  }
  function changed(){render();onChange();}
  function leaf(node,replace,remove) {
    const row=document.createElement('div');row.className='rule-leaf';
    const select=document.createElement('select');select.setAttribute('aria-label','Date condition');
    select.add(new Option('Assigned schedule','source:schedule'));
    for(const list of lists)select.add(new Option(list.name,'list:'+list.id));
    if(node.listId && !lists.some(l=>l.id===node.listId))select.add(new Option('Missing list','list:'+node.listId));
    select.value=node.source==='schedule' ? 'source:schedule':'list:'+node.listId;
    select.addEventListener('change',()=>{replace(select.value==='source:schedule'?{source:'schedule'}:{listId:select.value.slice(5)});changed();});
    const erase=button('','delete',()=>{remove();changed();});erase.setAttribute('aria-label','Remove condition');
    row.append(select,erase);return row;
  }
  function group(node,depth,remove) {
    const box=document.createElement('div');box.className='rule-group';
    const heading=document.createElement('div');heading.className='rule-group-heading';
    const select=document.createElement('select');select.setAttribute('aria-label','Group logic');
    select.add(new Option('All of these (AND)','all'));select.add(new Option('Any of these (OR)','any'));select.value=node.op;
    select.addEventListener('change',()=>{node.op=select.value;changed();});heading.append(select);
    if(remove){const erase=button('','delete',()=>{remove();changed();});erase.setAttribute('aria-label','Remove group');heading.append(erase);}
    box.append(heading);
    node.children.forEach((child,index)=>{
      const erase=()=>node.children.splice(index,1);
      box.append(child.children ? group(child,depth+1,erase):leaf(child,value=>node.children[index]=value,erase));
    });
    if(!node.children.length){const note=document.createElement('p');note.className='helper-text error';note.textContent='Add at least one condition.';box.append(note);}
    const actions=document.createElement('div');actions.className='rule-actions';
    actions.append(button('Condition','plus',()=>{node.children.push(firstLeaf());changed();}));
    if(depth<5)actions.append(button('Group','group',()=>{node.children.push({op:'any',children:[firstLeaf()]});changed();}));
    box.append(actions);return box;
  }
  function rootGroup(key) {
    let node=conditions[key];
    if(!node.children)conditions[key]=node={op:'all',children:[node]};
    return group(node,0,null);
  }
  function render() {
    host.replaceChildren();
    const label=document.createElement('label');label.className='checkbox-line';
    const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.checked=enabled;checkbox.addEventListener('change',()=>{enabled=checkbox.checked;changed();});
    label.append(checkbox,document.createTextNode('Use date rules'));host.append(label);
    if(!enabled)return;
    const help=document.createElement('p');help.className='helper-text';help.textContent='The start time applies to all dates. All = AND; Any = OR. Nested groups combine lists without typing parentheses. Exclusions always win. Missed or excluded occurrences are skipped.';host.append(help);
    if(!lists.length) {
      const note=document.createElement('p');note.className='helper-text';note.append('No date lists yet. ');
      const link=document.createElement('a');link.href='dashboard.html?view=lists';link.target='_blank';link.textContent='Create a date list';link.className='text-link';note.append(link);host.append(note);
    }
    const title=document.createElement('h3');title.className='rule-title';title.textContent='Wake on';host.append(title,rootGroup('include'));
    if(conditions.exclude){
      const head=document.createElement('div');head.className='rule-section-heading';
      const title=document.createElement('h3');title.className='rule-title';title.textContent='Except when';
      head.append(title,button('Remove exclusions','close',()=>{conditions.exclude=null;changed();}));host.append(head,rootGroup('exclude'));
    }else host.append(button('Add exclusions','filter',()=>{conditions.exclude={op:'any',children:[firstLeaf()]};changed();}));
    const summary=document.createElement('p');summary.className='helper-text rule-readable';summary.textContent='Wake on '+describeExpression(conditions.include,lists)+(conditions.exclude ? '; except '+describeExpression(conditions.exclude,lists):'');host.append(summary);
  }
  render();
  return {value:()=>enabled ? normalizeConditions(conditions):null,hasLists:()=>enabled && [...expressionListIds(conditions.include),...expressionListIds(conditions.exclude)].length>0};
}
