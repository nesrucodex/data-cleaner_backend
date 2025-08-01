SELECT
  `r`.`name` AS `role_name`,
  `er`.`entity_role_id` AS `bank_id`,
  `e`.`entity_id` AS `entity_id`,
  `e`.`name` AS `bank_name`
FROM
  (
    (
      `ENTITIES_PROD`.`role` `r`
      LEFT JOIN `ENTITIES_PROD`.`entity_role` `er` ON((`r`.`role_id` = `er`.`role_id`))
    )
    LEFT JOIN `ENTITIES_PROD`.`entity` `e` ON((`e`.`entity_id` = `er`.`entity_id`))
  )
WHERE
  (`r`.`role_id` = 14)
GROUP BY
  `r`.`name`,
  `er`.`entity_role_id`,
  `e`.`entity_id`,
  `e`.`name`
ORDER BY
  `er`.`entity_role_id`