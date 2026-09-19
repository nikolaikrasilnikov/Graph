// Layouts refer to stable node IDs, not transient terminal pane IDs.
export function validateLayout(value){
  if(!value||typeof value.name!=='string'||!value.name.trim()||value.name.length>60)throw new Error('Название раскладки: 1–60 символов.');
  let leaves=0;const ids=new Set();
  const walk=(node,depth=0)=>{if(depth>8||!node)throw new Error('Слишком сложная раскладка.');if(node.type==='leaf'){if(++leaves>12||typeof node.id!=='string'||!/^[-\w]{1,100}$/.test(node.id)||ids.has(node.id)||node.nodeId!==null&&(typeof node.nodeId!=='string'||!/^[-\w]{1,100}$/.test(node.nodeId)))throw new Error('Некорректное окно.');ids.add(node.id);return {type:'leaf',id:node.id,nodeId:node.nodeId};}if(node.type!=='split'||!['row','column'].includes(node.axis)||!Number.isFinite(node.ratio)||node.ratio<.15||node.ratio>.85)throw new Error('Некорректный разделитель.');return {type:'split',axis:node.axis,ratio:node.ratio,a:walk(node.a,depth+1),b:walk(node.b,depth+1)};};
  return {name:value.name.trim(),tree:walk(value.tree)};
}
export function leaves(tree){return tree.type==='leaf'?[tree]:[...leaves(tree.a),...leaves(tree.b)];}
export function removeLeaf(tree,id){if(tree.type==='leaf')return tree.id===id?null:tree;const a=removeLeaf(tree.a,id),b=removeLeaf(tree.b,id);return a&&b?{...tree,a,b}:a||b;}
export function splitLeaf(tree,id,axis,newLeaf){if(tree.type==='leaf')return tree.id===id?{type:'split',axis,ratio:.5,a:tree,b:newLeaf}:tree;return {...tree,a:splitLeaf(tree.a,id,axis,newLeaf),b:splitLeaf(tree.b,id,axis,newLeaf)};}
