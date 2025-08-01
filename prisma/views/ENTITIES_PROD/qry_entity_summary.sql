SELECT
  NULL AS `role_id`,
  'All Entities' AS `role_name`,
  count(0) AS `imported_records`,
  '-' AS `orphans`,
  concat(
    (
      SELECT
        count(0) AS `total_accounts`
      FROM
        `ENTITIES_PROD`.`bank_account` `b`
    ),
    ''
  ) AS `total_banks`,
  concat(
    (
      SELECT
        count(0) AS `total_accounts`
      FROM
        `ENTITIES_PROD`.`bank_account` `b`
      WHERE
        (`b`.`IBAN` IS NOT NULL)
    ),
    ''
  ) AS `iban`,
  concat(
    (
      SELECT
        count(0) AS `total_accounts`
      FROM
        `ENTITIES_PROD`.`bank_account` `b`
      WHERE
        (
          (`b`.`IBAN` IS NULL)
          AND (`b`.`account` IS NOT NULL)
        )
    ),
    ''
  ) AS `account_no`,
  concat(
    (
      SELECT
        count(0) AS `total_accounts`
      FROM
        `ENTITIES_PROD`.`bank_account` `b`
      WHERE
        (
          (`b`.`IBAN` IS NULL)
          AND (`b`.`account` IS NULL)
          AND (`b`.`account_ref` IS NOT NULL)
        )
    ),
    ''
  ) AS `account_ref`
FROM
  `ENTITIES_PROD`.`entity`
UNION
SELECT
  NULL AS `role_id`,
  'Entities without roles' AS `role_name`,
  count(0) AS `imported_records`,
  '-' AS `orphans`,
  '-' AS `total_accounts`,
  '-' AS `iban_accounts`,
  '-' AS `accounts`,
  '-' AS `ref_accounts`
FROM
  `ENTITIES_PROD`.`entity` `e`
WHERE
  `e`.`entity_id` IN (
    SELECT
      `ENTITIES_PROD`.`entity_role`.`entity_id`
    FROM
      `ENTITIES_PROD`.`entity_role`
  ) IS false
UNION
SELECT
  NULL AS `role_id`,
  'Entities with roles' AS `role_name`,
  count(0) AS `imported_records`,
  '-' AS `orphans`,
  concat(
    (
      SELECT
        count(0) AS `total_accounts`
      FROM
        (
          (
            `ENTITIES_PROD`.`bank_account` `b`
            JOIN `ENTITIES_PROD`.`entity_role` `e` ON((`b`.`entity_id` = `e`.`entity_id`))
          )
          JOIN `ENTITIES_PROD`.`role` `r` ON((`e`.`role_id` = `r`.`role_id`))
        )
    ),
    ''
  ) AS `total_accounts`,
  concat(
    (
      SELECT
        count(0) AS `total_accounts`
      FROM
        (
          (
            `ENTITIES_PROD`.`bank_account` `b`
            JOIN `ENTITIES_PROD`.`entity_role` `e` ON((`b`.`entity_id` = `e`.`entity_id`))
          )
          JOIN `ENTITIES_PROD`.`role` `r` ON((`e`.`role_id` = `r`.`role_id`))
        )
      WHERE
        (`b`.`IBAN` IS NOT NULL)
    ),
    ''
  ) AS `iban_accounts`,
  concat(
    (
      SELECT
        count(0) AS `total_accounts`
      FROM
        (
          (
            `ENTITIES_PROD`.`bank_account` `b`
            JOIN `ENTITIES_PROD`.`entity_role` `e` ON((`b`.`entity_id` = `e`.`entity_id`))
          )
          JOIN `ENTITIES_PROD`.`role` `r` ON((`e`.`role_id` = `r`.`role_id`))
        )
      WHERE
        (
          (`b`.`IBAN` IS NULL)
          AND (`b`.`account` IS NOT NULL)
        )
    ),
    ''
  ) AS `accounts`,
  concat(
    (
      SELECT
        count(0) AS `total_accounts`
      FROM
        (
          (
            `ENTITIES_PROD`.`bank_account` `b`
            JOIN `ENTITIES_PROD`.`entity_role` `e` ON((`b`.`entity_id` = `e`.`entity_id`))
          )
          JOIN `ENTITIES_PROD`.`role` `r` ON((`e`.`role_id` = `r`.`role_id`))
        )
      WHERE
        (
          (`b`.`IBAN` IS NULL)
          AND (`b`.`account` IS NULL)
          AND (`b`.`account_ref` IS NOT NULL)
        )
    ),
    ''
  ) AS `accounts_ref`
FROM
  `ENTITIES_PROD`.`entity` `e`
WHERE
  `e`.`entity_id` IN (
    SELECT
      `ENTITIES_PROD`.`entity_role`.`entity_id`
    FROM
      `ENTITIES_PROD`.`entity_role`
  )
UNION
SELECT
  `r`.`role_id` AS `role_id`,
  `r`.`name` AS `name`,
  count(`er`.`entity_id`) AS `imported_records`,
  coalesce(
    (
      SELECT
        count(0) AS `total_accounts`
      FROM
        (
          `ENTITIES_PROD`.`entity_role` `e`
          LEFT JOIN `ENTITIES_PROD`.`bank_account` `b` ON((`b`.`entity_id` = `e`.`entity_id`))
        )
      WHERE
        (
          (`b`.`entity_id` IS NULL)
          AND (`e`.`role_id` = `r`.`role_id`)
        )
    ),
    '-'
  ) AS `orphans`,
  coalesce(
    (
      SELECT
        count(0) AS `total_accounts`
      FROM
        (
          `ENTITIES_PROD`.`bank_account` `b`
          JOIN `ENTITIES_PROD`.`entity_role` `e` ON((`b`.`entity_id` = `e`.`entity_id`))
        )
      WHERE
        (`e`.`role_id` = `r`.`role_id`)
    ),
    '-'
  ) AS `total_account`,
  coalesce(`b1`.`total_accounts`, '-') AS `iban_accounts`,
  coalesce(`b2`.`total_accounts`, '-') AS `accounts`,
  coalesce(`b3`.`total_accounts`, '-') AS `ref_accounts`
FROM
  (
    (
      (
        (
          `ENTITIES_PROD`.`role` `r`
          LEFT JOIN `ENTITIES_PROD`.`entity_role` `er` ON((`r`.`role_id` = `er`.`role_id`))
        )
        LEFT JOIN (
          SELECT
            `r`.`role_id` AS `role_id`,
            `r`.`name` AS `role_name`,
            count(0) AS `total_accounts`
          FROM
            (
              (
                `ENTITIES_PROD`.`bank_account` `b`
                JOIN `ENTITIES_PROD`.`entity_role` `e` ON((`b`.`entity_id` = `e`.`entity_id`))
              )
              JOIN `ENTITIES_PROD`.`role` `r` ON((`e`.`role_id` = `r`.`role_id`))
            )
          WHERE
            (`b`.`IBAN` IS NOT NULL)
          GROUP BY
            `r`.`role_id`,
            `r`.`name`
        ) `b1` ON((`r`.`role_id` = `b1`.`role_id`))
      )
      LEFT JOIN (
        SELECT
          `r`.`role_id` AS `role_id`,
          `r`.`name` AS `role_name`,
          count(0) AS `total_accounts`
        FROM
          (
            (
              `ENTITIES_PROD`.`bank_account` `b`
              JOIN `ENTITIES_PROD`.`entity_role` `e` ON((`b`.`entity_id` = `e`.`entity_id`))
            )
            JOIN `ENTITIES_PROD`.`role` `r` ON((`e`.`role_id` = `r`.`role_id`))
          )
        WHERE
          (
            (`b`.`IBAN` IS NULL)
            AND (`b`.`account` IS NOT NULL)
          )
        GROUP BY
          `r`.`role_id`,
          `r`.`name`
      ) `b2` ON((`r`.`role_id` = `b2`.`role_id`))
    )
    LEFT JOIN (
      SELECT
        `r`.`role_id` AS `role_id`,
        `r`.`name` AS `role_name`,
        count(0) AS `total_accounts`
      FROM
        (
          (
            `ENTITIES_PROD`.`bank_account` `b`
            JOIN `ENTITIES_PROD`.`entity_role` `e` ON((`b`.`entity_id` = `e`.`entity_id`))
          )
          JOIN `ENTITIES_PROD`.`role` `r` ON((`e`.`role_id` = `r`.`role_id`))
        )
      WHERE
        (
          (`b`.`IBAN` IS NULL)
          AND (`b`.`account` IS NULL)
          AND (`b`.`account_ref` IS NOT NULL)
        )
      GROUP BY
        `r`.`role_id`,
        `r`.`name`
    ) `b3` ON((`r`.`role_id` = `b3`.`role_id`))
  )
WHERE
  (`r`.`role_id` NOT IN (9, 10, 11, 8))
GROUP BY
  `r`.`role_id`,
  `r`.`name`,
  `b1`.`total_accounts`,
  `b2`.`total_accounts`,
  `b3`.`total_accounts`
UNION
SELECT
  10 AS `role_id`,
  'Debtor' AS `role_name`,
  count(0) AS `imported`,
  sum(
    IF(
      (
        (
          coalesce(`ENTITIES_PROD`.`q`.`iban_count`, 0) + coalesce(`ENTITIES_PROD`.`q`.`account_count`, 0)
        ) = 0
      ),
      1,
      0
    )
  ) AS `orphans`,
(
    sum(`ENTITIES_PROD`.`q`.`iban_count`) + sum(`ENTITIES_PROD`.`q`.`account_count`)
  ) AS `total_banks`,
  sum(`ENTITIES_PROD`.`q`.`iban_count`) AS `total_ibans`,
  sum(`ENTITIES_PROD`.`q`.`account_count`) AS `total_accounts`,
  0 AS `account_ref`
FROM
  `ENTITIES_PROD`.`qry_entity_role_debtor` `q`
UNION
SELECT
  11 AS `role_id`,
  'Creditor' AS `role_name`,
  count(0) AS `imported`,
  sum(
    IF(
      (
        (
          coalesce(`ENTITIES_PROD`.`q`.`iban_count`, 0) + coalesce(`ENTITIES_PROD`.`q`.`account_count`, 0)
        ) = 0
      ),
      1,
      0
    )
  ) AS `orphans`,
(
    sum(`ENTITIES_PROD`.`q`.`iban_count`) + sum(`ENTITIES_PROD`.`q`.`account_count`)
  ) AS `total_banks`,
  sum(`ENTITIES_PROD`.`q`.`iban_count`) AS `total_ibans`,
  sum(`ENTITIES_PROD`.`q`.`account_count`) AS `total_accounts`,
  0 AS `account_ref`
FROM
  `ENTITIES_PROD`.`qry_entity_role_creditor` `q`
UNION
SELECT
  9 AS `role_id`,
  'Credebtor' AS `role_name`,
  count(0) AS `imported`,
  sum(
    IF(
      (
        (
          (
            coalesce(`ENTITIES_PROD`.`q`.`debtor_iban_count`, 0) + coalesce(`ENTITIES_PROD`.`q`.`debtor_account_count`, 0)
          ) + coalesce(`ENTITIES_PROD`.`q`.`creditor_iban_count`, 0)
        ) + coalesce(`ENTITIES_PROD`.`q`.`creditor_account_count`, 0)
      ),
      1,
      0
    )
  ) AS `orphans`,
(
    (
      (
        sum(`ENTITIES_PROD`.`q`.`debtor_iban_count`) + sum(`ENTITIES_PROD`.`q`.`debtor_account_count`)
      ) + sum(`ENTITIES_PROD`.`q`.`creditor_iban_count`)
    ) + sum(`ENTITIES_PROD`.`q`.`creditor_account_count`)
  ) AS `total_banks`,
(
    sum(`ENTITIES_PROD`.`q`.`debtor_iban_count`) + sum(`ENTITIES_PROD`.`q`.`creditor_iban_count`)
  ) AS `total_ibans`,
(
    sum(`ENTITIES_PROD`.`q`.`debtor_account_count`) + sum(`ENTITIES_PROD`.`q`.`creditor_account_count`)
  ) AS `total_accounts`,
  0 AS `account_ref`
FROM
  `ENTITIES_PROD`.`qry_entity_role_credebtor` `q`
ORDER BY
  `role_id`,
  `role_name`