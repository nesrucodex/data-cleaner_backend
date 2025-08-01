SELECT
  `r`.`name` AS `role_name`,
  `er`.`entity_role_id` AS `originator_id`,
  `e`.`entity_id` AS `entity_id`,
  `e`.`name` AS `originator_name`,
(
    SELECT
      count(0)
    FROM
      `ENTITIES_PROD`.`entity_role` `r1`
    WHERE
      (
        (`r1`.`parent_role_id` = `er`.`entity_role_id`)
        AND (`r1`.`role_id` = 10)
      )
  ) AS `debtors`,
(
    SELECT
      count(0)
    FROM
      `ENTITIES_PROD`.`entity_role` `r1`
    WHERE
      (
        (`r1`.`parent_role_id` = `er`.`entity_role_id`)
        AND (`r1`.`role_id` = 11)
      )
  ) AS `creditors`,
  GROUP_CONCAT(`b`.`IBAN` SEPARATOR ',') AS `ibans`
FROM
  (
    (
      (
        `ENTITIES_PROD`.`role` `r`
        LEFT JOIN `ENTITIES_PROD`.`entity_role` `er` ON((`r`.`role_id` = `er`.`role_id`))
      )
      LEFT JOIN `ENTITIES_PROD`.`entity` `e` ON((`e`.`entity_id` = `er`.`entity_id`))
    )
    LEFT JOIN `ENTITIES_PROD`.`bank_account` `b` ON((`b`.`entity_id` = `er`.`entity_id`))
  )
WHERE
  (`r`.`role_id` = 1)
GROUP BY
  `r`.`name`,
  `er`.`entity_role_id`,
  `e`.`entity_id`
ORDER BY
  `e`.`name`