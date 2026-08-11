UPDATE passes
   SET d10 = 1
 WHERE run_id NOT IN (SELECT run_id FROM escalations);
