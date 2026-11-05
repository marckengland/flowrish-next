import { expect,it } from 'vitest'
import { followUpFilterSql } from '../follow-up-filter-sql'
it('uses parameterized literal substring matching and independently composes source and due predicates',()=>{
 const term="50%_ O'Neil",q=followUpFilterSql({search:term,source:'CALL',dueOnly:true});expect(q.text).toContain('strpos(lower("searchText"),lower(');expect(q.text).not.toContain(term);expect(q.text).not.toMatch(/ILIKE| LIKE /);expect(q.values).toContain(term);expect(q.values).toContain('CALL');expect(q.text).toContain("status='PENDING'");expect(q.text).toContain('until IS NOT NULL');expect(q.text).toContain("timezone('UTC',statement_timestamp())")
})
it('leaves unfiltered queries unrestricted without requiring new parameters',()=>{const q=followUpFilterSql({search:'',source:'ALL',dueOnly:false});expect(q.values).toEqual([]);expect(q.text).not.toContain('strpos');expect(q.text).not.toContain('until<=')})
