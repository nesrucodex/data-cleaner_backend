SELECT
  `r`.`name` AS `role_name`,
  `er`.`entity_role_id` AS `intermediary_id`,
  `e`.`entity_id` AS `entity_id`,
  `e`.`name` AS `intermediary_name`,
  GROUP_CONCAT(`n`.`IBAN` SEPARATOR ',') AS `ibans`
FROM
  (
    (
      (
        `ENTITIES_PROD`.`role` `r`
        LEFT JOIN `ENTITIES_PROD`.`entity_role` `er` ON((`r`.`role_id` = `er`.`role_id`))
      )
      LEFT JOIN `ENTITIES_PROD`.`entity` `e` ON((`e`.`entity_id` = `er`.`entity_id`))
    )
    LEFT JOIN `ENTITIES_PROD`.`bank_account` `n` ON((`er`.`entity_id` = `n`.`entity_id`))
  )
WHERE
  (`r`.`role_id` = 3)
GROUP BY
  `r`.`name`,
  `er`.`entity_role_id`,
  `e`.`entity_id`,
  `e`.`name`
ORDER BY
  `e`.`name`