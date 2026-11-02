import test from 'node:test';import assert from 'node:assert/strict';
import {businessActions,capabilities,destinationForAction,actionForDestination,semanticCapabilityCatalog,pageDestinations} from '../shared/capabilities.ts';
import {SemanticCommandSchema} from '../shared/conversation.ts';
test('business catalog separates semantic actions from unique page destinations',()=>{
 assert.equal(new Set(businessActions.map(destinationForAction)).size,businessActions.length);
 for(const action of businessActions){
  const legacy=destinationForAction(action);assert.equal(actionForDestination(legacy),action);assert.deepEqual(pageDestinations[legacy],capabilities[action].page);
  const command=SemanticCommandSchema.parse({operation:action});assert.equal(command.capability,legacy);assert.equal(command.operation,'navigate');
 }
 assert.ok(semanticCapabilityCatalog.every(c=>!('page' in c)&&!('legacy' in c)&&c.distinction&&c.purpose));
 assert.equal(SemanticCommandSchema.safeParse({operation:'transfer'}).success,false);
 assert.equal(SemanticCommandSchema.safeParse({operation:'/api/execute'}).success,false);
});
