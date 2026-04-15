-- =============================================================================
-- BOVIBOT - Semaine 2 : Triggers et Events MySQL
-- À exécuter APRÈS schema.sql
-- Skill : mysql-plsql-expert (MySQL 8.x strict)
-- =============================================================================

USE bovibot;

-- S'assurer que l'event scheduler est bien actif
SET GLOBAL event_scheduler = ON;


-- =============================================================================
-- SECTION 1 : TRIGGERS
-- =============================================================================

DELIMITER //

-- -----------------------------------------------------------------------------
-- Trigger : trg_historique_statut
-- Événement : BEFORE UPDATE sur animaux
-- Rôle    : Journalise chaque changement de statut dans historique_statut
--           (actif → vendu, actif → mort, etc.)
-- Test    : UPDATE animaux SET statut = 'vendu' WHERE id = 4;
--           SELECT * FROM historique_statut;
-- -----------------------------------------------------------------------------
CREATE TRIGGER trg_historique_statut
BEFORE UPDATE ON animaux
FOR EACH ROW
BEGIN
    -- Journalisation uniquement si le statut change réellement
    IF OLD.statut != NEW.statut THEN
        INSERT INTO historique_statut (
            animal_id,
            ancien_statut,
            nouveau_statut,
            date_changement,
            modifie_par
        )
        VALUES (
            OLD.id,
            OLD.statut,
            NEW.statut,
            NOW(),
            'system'
        );
    END IF;
END //


-- -----------------------------------------------------------------------------
-- Trigger : trg_alerte_vaccination
-- Événement : AFTER INSERT sur sante
-- Rôle    : Génère une alerte si le prochain rendez-vous vétérinaire
--           renseigné est déjà dépassé au moment de l'insertion
-- Test    : INSERT INTO sante (animal_id, type, date_acte, prochain_rdv)
--           VALUES (1, 'vaccination', '2024-01-01', '2024-06-01');
--           → prochain_rdv dans le passé → alerte générée
-- -----------------------------------------------------------------------------
CREATE TRIGGER trg_alerte_vaccination
AFTER INSERT ON sante
FOR EACH ROW
BEGIN
    DECLARE v_numero_tag VARCHAR(20);

    IF NEW.prochain_rdv IS NOT NULL AND NEW.prochain_rdv < CURDATE() THEN

        -- Récupération du tag pour un message lisible
        SELECT numero_tag INTO v_numero_tag
        FROM   animaux
        WHERE  id = NEW.animal_id
        LIMIT  1;

        INSERT INTO alertes (type, message, niveau, animal_id)
        VALUES (
            'vaccination_manquee',
            CONCAT(
                'RENDEZ-VOUS VÉTÉRINAIRE DÉPASSÉ : ', COALESCE(v_numero_tag, CONCAT('ID-', NEW.animal_id)),
                ' - Acte "', NEW.type, '" du ', NEW.date_acte,
                ' - Prochain RDV prévu le ', NEW.prochain_rdv,
                ' (dépassé de ', DATEDIFF(CURDATE(), NEW.prochain_rdv), ' jour(s)).'
            ),
            'avertissement',
            NEW.animal_id
        );
    END IF;
END //


-- -----------------------------------------------------------------------------
-- Trigger : trg_alerte_poids_faible
-- Événement : AFTER INSERT sur pesees
-- Rôle    : Génère une alerte critique si un veau (< 6 mois) pèse
--           moins de 60 kg — capture aussi les inserts directs (hors procédure)
-- Note    : Inclut une vérification anti-doublon pour éviter la duplication
--           avec l'alerte générée par sp_enregistrer_pesee
-- Test    : INSERT INTO pesees (animal_id, poids_kg, date_pesee, agent)
--           VALUES (6, 45.00, CURDATE(), 'test_direct');
-- -----------------------------------------------------------------------------
CREATE TRIGGER trg_alerte_poids_faible
AFTER INSERT ON pesees
FOR EACH ROW
BEGIN
    DECLARE v_age_mois   INT;
    DECLARE v_numero_tag VARCHAR(20);

    SET v_age_mois = fn_age_en_mois(NEW.animal_id);

    -- Condition : veau de moins de 6 mois avec poids critique (< 60 kg)
    IF v_age_mois >= 0 AND v_age_mois < 6 AND NEW.poids_kg < 60.00 THEN

        -- Anti-doublon : n'insérer que si aucune alerte de ce type n'existe déjà pour aujourd'hui
        IF NOT EXISTS (
            SELECT 1
            FROM   alertes
            WHERE  animal_id = NEW.animal_id
            AND    type = 'poids_critique'
            AND    DATE(created_at) = DATE(NEW.date_pesee)
        ) THEN

            SELECT numero_tag INTO v_numero_tag
            FROM   animaux
            WHERE  id = NEW.animal_id
            LIMIT  1;

            INSERT INTO alertes (type, message, niveau, animal_id)
            VALUES (
                'poids_critique',
                CONCAT(
                    'ALERTE CRITIQUE : ', COALESCE(v_numero_tag, CONCAT('ID-', NEW.animal_id)),
                    ' - Veau de ', v_age_mois, ' mois pèse seulement ', NEW.poids_kg,
                    ' kg. Seuil critique : 60 kg avant 6 mois.'
                ),
                'critique',
                NEW.animal_id
            );
        END IF;
    END IF;
END //

DELIMITER ;


-- =============================================================================
-- SECTION 2 : EVENTS MYSQL SCHEDULER
-- =============================================================================

DELIMITER //

-- -----------------------------------------------------------------------------
-- Event   : evt_alerte_velages
-- Fréquence : Quotidien (toutes les 24h)
-- Rôle    : Supprime les anciennes alertes de type velage_imminent non traitées
--           puis recrée les alertes pour les vêlages prévus dans les 7 prochains jours
-- Test    : UPDATE reproduction SET date_velage_prevue = DATE_ADD(CURDATE(), INTERVAL 3 DAY)
--           WHERE id = 1;
--           CALL mysql.event_name_execute('evt_alerte_velages'); -- ou attendre 24h
-- -----------------------------------------------------------------------------
CREATE EVENT IF NOT EXISTS evt_alerte_velages
ON SCHEDULE EVERY 1 DAY
STARTS CURRENT_TIMESTAMP
COMMENT 'Génère des alertes quotidiennes pour les vêlages imminents (J-7)'
DO
BEGIN
    -- Suppression des alertes velage_imminent non traitées (évite l'accumulation)
    DELETE FROM alertes
    WHERE  type = 'velage_imminent'
    AND    traitee = 0;

    -- Insertion des nouvelles alertes pour vêlages dans les 7 prochains jours
    INSERT INTO alertes (type, message, niveau, animal_id)
    SELECT
        'velage_imminent',
        CONCAT(
            'VÊLAGE IMMINENT : ', a.numero_tag,
            ' (', COALESCE(a.nom, 'Sans nom'), ')',
            ' - Date prévue : ', r.date_velage_prevue,
            ' (dans ', DATEDIFF(r.date_velage_prevue, CURDATE()), ' jour(s)).'
        ),
        'avertissement',
        r.mere_id
    FROM  reproduction r
    INNER JOIN animaux a ON a.id = r.mere_id
    WHERE r.statut = 'en_cours'
    AND   r.date_velage_prevue BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY);
END //


-- -----------------------------------------------------------------------------
-- Event   : evt_rapport_croissance
-- Fréquence : Hebdomadaire (toutes les 7 jours)
-- Rôle    : Génère un résumé de croissance pour chaque animal actif
--           (poids actuel, GMQ, âge) inséré dans les alertes de niveau 'info'
-- Note    : Ces alertes servent de rapport de bord dans le tableau de bord
-- -----------------------------------------------------------------------------
CREATE EVENT IF NOT EXISTS evt_rapport_croissance
ON SCHEDULE EVERY 1 WEEK
STARTS CURRENT_TIMESTAMP
COMMENT 'Rapport hebdomadaire de croissance du troupeau dans les alertes'
DO
BEGIN
    -- Suppression des anciens rapports de croissance non traités
    DELETE FROM alertes
    WHERE  type = 'rapport_croissance'
    AND    traitee = 0;

    -- Insertion du rapport pour chaque animal actif
    INSERT INTO alertes (type, message, niveau, animal_id)
    SELECT
        'rapport_croissance',
        CONCAT(
            'RAPPORT HEBDO | ', a.numero_tag,
            ' | Âge : ', fn_age_en_mois(a.id), ' mois',
            ' | Poids : ', COALESCE(a.poids_actuel_kg, 'N/A'), ' kg',
            ' | GMQ : ',
            CASE
                WHEN fn_gmq(a.id) >= 0 THEN CONCAT(fn_gmq(a.id), ' kg/j')
                ELSE 'Insuffisant (< 2 pesées)'
            END
        ),
        'info',
        a.id
    FROM animaux a
    WHERE a.statut = 'actif';
END //

DELIMITER ;


-- =============================================================================
-- REQUÊTES DE VÉRIFICATION (décommenter pour tester)
-- =============================================================================

-- -- Test trg_historique_statut :
-- UPDATE animaux SET statut = 'mort' WHERE id = 4;
-- SELECT * FROM historique_statut ORDER BY date_changement DESC;

-- -- Test trg_alerte_vaccination (prochain_rdv dépassé) :
-- INSERT INTO sante (animal_id, type, date_acte, veterinaire, prochain_rdv)
-- VALUES (2, 'vaccination', '2025-01-01', 'Dr. Test', '2025-06-01');
-- SELECT * FROM alertes WHERE type = 'vaccination_manquee' ORDER BY created_at DESC;

-- -- Test trg_alerte_poids_faible (veau sous-pondéral via INSERT direct) :
-- INSERT INTO pesees (animal_id, poids_kg, date_pesee, agent)
-- VALUES (6, 45.00, CURDATE(), 'test_direct');
-- SELECT * FROM alertes WHERE type = 'poids_critique' ORDER BY created_at DESC;

-- -- Test evt_alerte_velages (forcer vêlage dans 3 jours) :
-- UPDATE reproduction SET date_velage_prevue = DATE_ADD(CURDATE(), INTERVAL 3 DAY) WHERE id = 1;
-- -- Attendre le déclenchement quotidien ou simuler via ALTER EVENT ... ON SCHEDULE AT NOW()

-- -- Vérification globale des alertes :
-- SELECT type, niveau, message, traitee, created_at FROM alertes ORDER BY created_at DESC;

-- =============================================================================
-- FIN DU FICHIER triggers_events.sql
-- =============================================================================
