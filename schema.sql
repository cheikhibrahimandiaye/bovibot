-- =============================================================================
-- BOVIBOT - Base de données de gestion d'élevage bovin avec IA et PL/SQL
-- Projet académique L3 - ESP/UCAD
-- Auteur  : [Votre nom]
-- Date    : 2026-04-04
-- Skill   : mysql-plsql-expert (MySQL 8.x strict)
-- =============================================================================

-- =============================================================================
-- SECTION 1 : CONFIGURATION INITIALE
-- =============================================================================

CREATE DATABASE IF NOT EXISTS bovibot
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_unicode_ci;

USE bovibot;

-- Activation obligatoire du planificateur d'événements MySQL
SET GLOBAL event_scheduler = ON;


-- =============================================================================
-- SECTION 2 : CRÉATION DES TABLES
-- Ordre respectant les dépendances de clés étrangères
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Table : races
-- Rôle  : Référentiel des races bovines gérées dans l'élevage
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS races (
    id                    INT UNSIGNED    NOT NULL AUTO_INCREMENT,
    nom                   VARCHAR(100)    NOT NULL,
    origine               VARCHAR(100)    NULL,
    poids_adulte_moyen_kg DECIMAL(6, 2)   NULL COMMENT 'Poids adulte moyen en kg pour cette race',
    created_at            DATETIME        NOT NULL DEFAULT NOW(),

    CONSTRAINT pk_races PRIMARY KEY (id),
    CONSTRAINT uq_races_nom UNIQUE (nom)
) ENGINE = InnoDB COMMENT 'Référentiel des races bovines';


-- -----------------------------------------------------------------------------
-- Table : animaux
-- Rôle  : Individus du troupeau avec traçabilité généalogique (mère/père)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS animaux (
    id               INT UNSIGNED                      NOT NULL AUTO_INCREMENT,
    numero_tag       VARCHAR(20)                       NOT NULL COMMENT 'Identifiant physique (ex: TAG-001)',
    nom              VARCHAR(100)                      NULL,
    race_id          INT UNSIGNED                      NOT NULL,
    sexe             ENUM('M', 'F')                    NOT NULL,
    date_naissance   DATE                              NOT NULL,
    statut           ENUM('actif', 'vendu', 'mort')    NOT NULL DEFAULT 'actif',
    mere_id          INT UNSIGNED                      NULL COMMENT 'FK auto-jointure vers la mère',
    pere_id          INT UNSIGNED                      NULL COMMENT 'FK auto-jointure vers le père',
    poids_actuel_kg  DECIMAL(6, 2)                     NULL COMMENT 'Mis à jour automatiquement à chaque pesée',
    created_at       DATETIME                          NOT NULL DEFAULT NOW(),

    CONSTRAINT pk_animaux          PRIMARY KEY (id),
    CONSTRAINT uq_animaux_tag      UNIQUE (numero_tag),
    CONSTRAINT fk_animaux_race     FOREIGN KEY (race_id) REFERENCES races(id),
    CONSTRAINT fk_animaux_mere     FOREIGN KEY (mere_id) REFERENCES animaux(id),
    CONSTRAINT fk_animaux_pere     FOREIGN KEY (pere_id) REFERENCES animaux(id)
) ENGINE = InnoDB COMMENT 'Individus du troupeau avec généalogie';


-- -----------------------------------------------------------------------------
-- Table : pesees
-- Rôle  : Historique complet des pesées pour suivi de croissance (GMQ)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pesees (
    id          INT UNSIGNED    NOT NULL AUTO_INCREMENT,
    animal_id   INT UNSIGNED    NOT NULL,
    poids_kg    DECIMAL(6, 2)   NOT NULL,
    date_pesee  DATE            NOT NULL,
    agent       VARCHAR(100)    NULL COMMENT 'Opérateur ayant effectué la pesée (humain ou BoviBot)',
    created_at  DATETIME        NOT NULL DEFAULT NOW(),

    CONSTRAINT pk_pesees        PRIMARY KEY (id),
    CONSTRAINT fk_pesees_animal FOREIGN KEY (animal_id) REFERENCES animaux(id)
) ENGINE = InnoDB COMMENT 'Historique des pesées pour calcul du GMQ';


-- -----------------------------------------------------------------------------
-- Table : sante
-- Rôle  : Suivi des actes vétérinaires (vaccinations, soins, contrôles)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sante (
    id           INT UNSIGNED    NOT NULL AUTO_INCREMENT,
    animal_id    INT UNSIGNED    NOT NULL,
    type         VARCHAR(100)    NOT NULL COMMENT 'Ex: vaccination, soin, contrôle, traitement',
    description  TEXT            NULL,
    date_acte    DATE            NOT NULL,
    veterinaire  VARCHAR(100)    NULL,
    prochain_rdv DATE            NULL COMMENT 'Déclenche une alerte si dépassé (trg_alerte_vaccination)',
    created_at   DATETIME        NOT NULL DEFAULT NOW(),

    CONSTRAINT pk_sante        PRIMARY KEY (id),
    CONSTRAINT fk_sante_animal FOREIGN KEY (animal_id) REFERENCES animaux(id)
) ENGINE = InnoDB COMMENT 'Actes vétérinaires et suivi sanitaire';


-- -----------------------------------------------------------------------------
-- Table : reproduction
-- Rôle  : Suivi des gestations et vêlages pour planification de l'élevage
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reproduction (
    id                 INT UNSIGNED                              NOT NULL AUTO_INCREMENT,
    mere_id            INT UNSIGNED                              NOT NULL,
    pere_id            INT UNSIGNED                              NULL,
    date_saillie       DATE                                      NULL,
    date_velage_prevue DATE                                      NULL COMMENT 'Utilisée par evt_alerte_velages',
    date_velage_reel   DATE                                      NULL,
    statut             ENUM('en_cours', 'velee', 'avortement')  NOT NULL DEFAULT 'en_cours',
    created_at         DATETIME                                  NOT NULL DEFAULT NOW(),

    CONSTRAINT pk_reproduction       PRIMARY KEY (id),
    CONSTRAINT fk_reproduction_mere  FOREIGN KEY (mere_id) REFERENCES animaux(id),
    CONSTRAINT fk_reproduction_pere  FOREIGN KEY (pere_id) REFERENCES animaux(id)
) ENGINE = InnoDB COMMENT 'Suivi des gestations et vêlages';


-- -----------------------------------------------------------------------------
-- Table : alimentation
-- Rôle  : Rations alimentaires journalières pour suivi des coûts
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS alimentation (
    id               INT UNSIGNED    NOT NULL AUTO_INCREMENT,
    animal_id        INT UNSIGNED    NOT NULL,
    type_aliment     VARCHAR(100)    NOT NULL COMMENT 'Ex: foin, concentré, paille, maïs',
    quantite_kg      DECIMAL(6, 2)   NOT NULL,
    cout_unitaire_kg DECIMAL(8, 2)   NOT NULL COMMENT 'Coût par kg en FCFA',
    date_ration      DATE            NOT NULL,
    created_at       DATETIME        NOT NULL DEFAULT NOW(),

    CONSTRAINT pk_alimentation        PRIMARY KEY (id),
    CONSTRAINT fk_alimentation_animal FOREIGN KEY (animal_id) REFERENCES animaux(id)
) ENGINE = InnoDB COMMENT 'Rations alimentaires et suivi des coûts';


-- -----------------------------------------------------------------------------
-- Table : ventes
-- Rôle  : Enregistrement des transactions de vente d'animaux
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ventes (
    id            INT UNSIGNED    NOT NULL AUTO_INCREMENT,
    animal_id     INT UNSIGNED    NOT NULL,
    acheteur      VARCHAR(150)    NOT NULL,
    telephone     VARCHAR(20)     NULL,
    prix_fcfa     DECIMAL(12, 2)  NOT NULL,
    poids_vente_kg DECIMAL(6, 2)  NULL,
    date_vente    DATE            NOT NULL,
    created_at    DATETIME        NOT NULL DEFAULT NOW(),

    CONSTRAINT pk_ventes        PRIMARY KEY (id),
    CONSTRAINT fk_ventes_animal FOREIGN KEY (animal_id) REFERENCES animaux(id)
) ENGINE = InnoDB COMMENT 'Transactions de vente des animaux';


-- -----------------------------------------------------------------------------
-- Table : alertes
-- Rôle  : Alertes système générées par les triggers, events et procédures
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS alertes (
    id         INT UNSIGNED                                  NOT NULL AUTO_INCREMENT,
    type       VARCHAR(100)                                  NOT NULL COMMENT 'Ex: poids_critique, vaccination_manquee, velage_imminent',
    message    TEXT                                          NOT NULL,
    niveau     ENUM('info', 'avertissement', 'critique')    NOT NULL DEFAULT 'info',
    traitee    TINYINT(1)                                   NOT NULL DEFAULT 0 COMMENT '0=non traitée, 1=traitée',
    animal_id  INT UNSIGNED                                  NULL COMMENT 'Optionnel: animal concerné',
    created_at DATETIME                                      NOT NULL DEFAULT NOW(),

    CONSTRAINT pk_alertes        PRIMARY KEY (id),
    CONSTRAINT fk_alertes_animal FOREIGN KEY (animal_id) REFERENCES animaux(id)
) ENGINE = InnoDB COMMENT 'Alertes système (triggers + events + procédures)';


-- -----------------------------------------------------------------------------
-- Table : historique_statut
-- Rôle  : Journal des changements de statut (alimenté par trg_historique_statut)
-- Note  : Créée en Semaine 1 pour que la FK soit prête pour le trigger Semaine 2
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS historique_statut (
    id             INT UNSIGNED                    NOT NULL AUTO_INCREMENT,
    animal_id      INT UNSIGNED                    NOT NULL,
    ancien_statut  ENUM('actif', 'vendu', 'mort')  NOT NULL,
    nouveau_statut ENUM('actif', 'vendu', 'mort')  NOT NULL,
    date_changement DATETIME                       NOT NULL DEFAULT NOW(),
    modifie_par    VARCHAR(100)                    NOT NULL DEFAULT 'system',

    CONSTRAINT pk_historique_statut        PRIMARY KEY (id),
    CONSTRAINT fk_historique_statut_animal FOREIGN KEY (animal_id) REFERENCES animaux(id)
) ENGINE = InnoDB COMMENT 'Journal des changements de statut (alimenté par trigger)';


-- =============================================================================
-- SECTION 3 : FONCTIONS PL/SQL
-- =============================================================================

DELIMITER //

-- -----------------------------------------------------------------------------
-- Fonction : fn_age_en_mois
-- Rôle     : Retourne l'âge d'un animal en mois entiers à la date du jour
-- Paramètre: p_animal_id INT UNSIGNED - ID de l'animal
-- Retourne : INT (âge en mois) | -1 si l'animal n'existe pas
-- Utilisation : SELECT fn_age_en_mois(1);
--               ... WHERE fn_age_en_mois(a.id) < 6 (veau)
-- -----------------------------------------------------------------------------
CREATE FUNCTION fn_age_en_mois(p_animal_id INT UNSIGNED)
RETURNS INT
DETERMINISTIC
READS SQL DATA
BEGIN
    DECLARE v_date_naissance DATE;
    DECLARE v_age_mois       INT;

    -- Récupération de la date de naissance
    SELECT date_naissance
    INTO   v_date_naissance
    FROM   animaux
    WHERE  id = p_animal_id
    LIMIT  1;

    -- Animal introuvable : retour sentinelle -1
    IF v_date_naissance IS NULL THEN
        RETURN -1;
    END IF;

    SET v_age_mois = TIMESTAMPDIFF(MONTH, v_date_naissance, CURDATE());

    RETURN v_age_mois;
END //


-- -----------------------------------------------------------------------------
-- Fonction : fn_gmq
-- Rôle     : Calcule le Gain Moyen Quotidien (kg/jour) depuis les pesées
-- Formule  : (poids_dernière_pesée - poids_première_pesée) / nb_jours
-- Paramètre: p_animal_id INT UNSIGNED - ID de l'animal
-- Retourne :  DECIMAL(6,3) GMQ en kg/jour
--            | 0.000 si moins de 2 pesées (insuffisant pour calculer)
--            | -1.000 si l'animal n'existe pas
-- Utilisation : SELECT fn_gmq(1);
--               ... HAVING fn_gmq(a.id) < 0.3
-- -----------------------------------------------------------------------------
CREATE FUNCTION fn_gmq(p_animal_id INT UNSIGNED)
RETURNS DECIMAL(6, 3)
DETERMINISTIC
READS SQL DATA
BEGIN
    DECLARE v_poids_premier  DECIMAL(6, 2);
    DECLARE v_date_premiere  DATE;
    DECLARE v_poids_dernier  DECIMAL(6, 2);
    DECLARE v_date_derniere  DATE;
    DECLARE v_nb_jours       INT;
    DECLARE v_animal_existe  TINYINT(1);

    -- Vérification existence de l'animal
    SELECT COUNT(*) INTO v_animal_existe FROM animaux WHERE id = p_animal_id;
    IF v_animal_existe = 0 THEN
        RETURN -1.000;
    END IF;

    -- Première pesée (ordre chronologique)
    SELECT poids_kg, date_pesee
    INTO   v_poids_premier, v_date_premiere
    FROM   pesees
    WHERE  animal_id = p_animal_id
    ORDER BY date_pesee ASC, id ASC
    LIMIT  1;

    -- Dernière pesée (ordre chronologique)
    SELECT poids_kg, date_pesee
    INTO   v_poids_dernier, v_date_derniere
    FROM   pesees
    WHERE  animal_id = p_animal_id
    ORDER BY date_pesee DESC, id DESC
    LIMIT  1;

    -- Moins de 2 pesées ou une seule pesée : GMQ incalculable
    IF v_poids_premier IS NULL OR v_date_premiere = v_date_derniere THEN
        RETURN 0.000;
    END IF;

    SET v_nb_jours = DATEDIFF(v_date_derniere, v_date_premiere);

    -- Sécurité division par zéro (pesées le même jour)
    IF v_nb_jours = 0 THEN
        RETURN 0.000;
    END IF;

    RETURN ROUND((v_poids_dernier - v_poids_premier) / v_nb_jours, 3);
END //

DELIMITER ;


-- =============================================================================
-- SECTION 4 : PROCÉDURES STOCKÉES
-- =============================================================================

DELIMITER //

-- -----------------------------------------------------------------------------
-- Procédure : sp_enregistrer_pesee
-- Rôle      : Enregistre une pesée, met à jour le poids actuel de l'animal,
--             calcule le GMQ et génère une alerte critique si veau sous-pondéral
-- Paramètres:
--   p_animal_id  INT UNSIGNED  - ID de l'animal
--   p_poids_kg   DECIMAL(6,2)  - Poids mesuré en kg
--   p_date_pesee DATE          - Date de la pesée
--   p_agent      VARCHAR(100)  - Opérateur (ex: 'BoviBot', 'Dr. Diallo')
-- Mode LLM  : Mode ACTION → confirmation obligatoire avant CALL
-- Usage     : CALL sp_enregistrer_pesee(1, 325.0, '2026-04-04', 'BoviBot');
-- -----------------------------------------------------------------------------
CREATE PROCEDURE sp_enregistrer_pesee(
    IN p_animal_id  INT UNSIGNED,
    IN p_poids_kg   DECIMAL(6, 2),
    IN p_date_pesee DATE,
    IN p_agent      VARCHAR(100)
)
BEGIN
    DECLARE v_statut     VARCHAR(10);
    DECLARE v_numero_tag VARCHAR(20);
    DECLARE v_age_mois   INT;
    DECLARE v_gmq        DECIMAL(6, 3);

    -- Gestionnaire d'erreurs : rollback propre si violation de contrainte
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    START TRANSACTION;

    -- -----------------------------------------------------------------------
    -- Étape 1 : Vérification que l'animal existe et est actif
    -- -----------------------------------------------------------------------
    SELECT statut, numero_tag
    INTO   v_statut, v_numero_tag
    FROM   animaux
    WHERE  id = p_animal_id
    FOR UPDATE;

    IF v_statut IS NULL THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Erreur : animal introuvable dans la base de données.';
    END IF;

    IF v_statut != 'actif' THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Erreur : impossible d\'enregistrer une pesée - l\'animal n\'est pas actif (vendu ou mort).';
    END IF;

    -- -----------------------------------------------------------------------
    -- Étape 2 : Insertion de la pesée
    -- -----------------------------------------------------------------------
    INSERT INTO pesees (animal_id, poids_kg, date_pesee, agent)
    VALUES (p_animal_id, p_poids_kg, p_date_pesee, p_agent);

    -- -----------------------------------------------------------------------
    -- Étape 3 : Mise à jour du poids actuel de l'animal
    -- -----------------------------------------------------------------------
    UPDATE animaux
    SET    poids_actuel_kg = p_poids_kg
    WHERE  id = p_animal_id;

    COMMIT;

    -- -----------------------------------------------------------------------
    -- Étape 4 : Calcul du GMQ post-commit
    -- -----------------------------------------------------------------------
    SET v_gmq      = fn_gmq(p_animal_id);
    SET v_age_mois = fn_age_en_mois(p_animal_id);

    -- -----------------------------------------------------------------------
    -- Étape 5 : Alerte critique si veau sous-pondéral (< 6 mois et < 60 kg)
    -- -----------------------------------------------------------------------
    IF v_age_mois < 6 AND p_poids_kg < 60.00 THEN
        INSERT INTO alertes (type, message, niveau, animal_id)
        VALUES (
            'poids_critique',
            CONCAT(
                'ALERTE CRITIQUE : ', v_numero_tag,
                ' - Veau de ', v_age_mois, ' mois pèse seulement ', p_poids_kg,
                ' kg (seuil critique : 60 kg avant 6 mois).'
            ),
            'critique',
            p_animal_id
        );
    END IF;

    -- -----------------------------------------------------------------------
    -- Étape 6 : Résultat de confirmation renvoyé au LLM / à l'application
    -- -----------------------------------------------------------------------
    SELECT
        v_numero_tag                                      AS animal_tag,
        p_poids_kg                                        AS poids_enregistre_kg,
        p_date_pesee                                      AS date_pesee,
        p_agent                                           AS agent,
        CASE WHEN v_gmq >= 0 THEN v_gmq ELSE NULL END     AS gmq_kg_par_jour,
        CASE
            WHEN v_age_mois < 6 AND p_poids_kg < 60 THEN 'CRITIQUE - Poids insuffisant pour un veau'
            WHEN v_gmq < 0.3 AND v_gmq >= 0          THEN 'AVERTISSEMENT - GMQ faible (< 0.3 kg/j)'
            ELSE                                           'OK'
        END                                               AS statut_alerte;
END //


-- -----------------------------------------------------------------------------
-- Procédure : sp_declarer_vente
-- Rôle      : Enregistre la vente d'un animal, change son statut en 'vendu'
--             et vérifie qu'il est bien actif avant toute transaction
-- Paramètres:
--   p_animal_id  INT UNSIGNED  - ID de l'animal
--   p_acheteur   VARCHAR(150)  - Nom de l'acheteur
--   p_telephone  VARCHAR(20)   - Téléphone acheteur (peut être NULL)
--   p_prix_fcfa  DECIMAL(12,2) - Prix de vente en FCFA
--   p_poids_kg   DECIMAL(6,2)  - Poids au moment de la vente (peut être NULL)
--   p_date_vente DATE          - Date de la transaction
-- Mode LLM  : Mode ACTION → confirmation obligatoire avant CALL
-- Usage     : CALL sp_declarer_vente(2, 'Oumar Ba', '+221771234567', 280000, 320.0, '2026-04-04');
-- -----------------------------------------------------------------------------
CREATE PROCEDURE sp_declarer_vente(
    IN p_animal_id  INT UNSIGNED,
    IN p_acheteur   VARCHAR(150),
    IN p_telephone  VARCHAR(20),
    IN p_prix_fcfa  DECIMAL(12, 2),
    IN p_poids_kg   DECIMAL(6, 2),
    IN p_date_vente DATE
)
BEGIN
    DECLARE v_statut      VARCHAR(10);
    DECLARE v_numero_tag  VARCHAR(20);
    DECLARE v_nom_animal  VARCHAR(100);
    DECLARE v_vente_id    INT UNSIGNED;

    -- Gestionnaire d'erreurs : rollback propre si violation de contrainte
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    START TRANSACTION;

    -- -----------------------------------------------------------------------
    -- Étape 1 : Vérification existence et statut de l'animal
    -- -----------------------------------------------------------------------
    SELECT statut, numero_tag, nom
    INTO   v_statut, v_numero_tag, v_nom_animal
    FROM   animaux
    WHERE  id = p_animal_id
    FOR UPDATE;

    IF v_statut IS NULL THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Erreur : animal introuvable dans la base de données.';
    END IF;

    IF v_statut = 'vendu' THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Erreur : cet animal a déjà été vendu. Vente impossible.';
    END IF;

    IF v_statut = 'mort' THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Erreur : cet animal est décédé. Vente impossible.';
    END IF;

    -- -----------------------------------------------------------------------
    -- Étape 2 : Insertion de la vente
    -- -----------------------------------------------------------------------
    INSERT INTO ventes (animal_id, acheteur, telephone, prix_fcfa, poids_vente_kg, date_vente)
    VALUES (p_animal_id, p_acheteur, p_telephone, p_prix_fcfa, p_poids_kg, p_date_vente);

    SET v_vente_id = LAST_INSERT_ID();

    -- -----------------------------------------------------------------------
    -- Étape 3 : Changement de statut de l'animal → 'vendu'
    -- Note    : Le trigger trg_historique_statut (Semaine 2) journalisera
    --           ce changement automatiquement dans historique_statut
    -- -----------------------------------------------------------------------
    UPDATE animaux
    SET    statut = 'vendu'
    WHERE  id = p_animal_id;

    COMMIT;

    -- -----------------------------------------------------------------------
    -- Étape 4 : Résultat de confirmation renvoyé au LLM / à l'application
    -- -----------------------------------------------------------------------
    SELECT
        v_vente_id                                                   AS vente_id,
        v_numero_tag                                                  AS animal_tag,
        COALESCE(v_nom_animal, 'Sans nom')                           AS animal_nom,
        p_acheteur                                                   AS acheteur,
        COALESCE(p_telephone, 'Non renseigné')                       AS telephone,
        FORMAT(p_prix_fcfa, 0)                                       AS prix_fcfa,
        COALESCE(CONCAT(p_poids_kg, ' kg'), 'Non renseigné')         AS poids_vente,
        p_date_vente                                                 AS date_vente,
        'vendu'                                                      AS nouveau_statut,
        'Vente enregistrée avec succès.'                             AS message;
END //

DELIMITER ;


-- =============================================================================
-- SECTION 5 : DONNÉES DE TEST
-- Jeu de données réaliste pour valider les fonctions et procédures
-- =============================================================================

-- --- Races -------------------------------------------------------------------
INSERT INTO races (nom, origine, poids_adulte_moyen_kg) VALUES
    ('Zébu Gobra',  'Sénégal',       350.00),
    ('Ndama',       'Guinée/Sénégal', 280.00),
    ('Taurin Baoulé','Côte d\'Ivoire', 260.00);

-- --- Animaux (6 individus) ---------------------------------------------------
-- D'abord les fondateurs sans parents
INSERT INTO animaux (numero_tag, nom, race_id, sexe, date_naissance, statut, mere_id, pere_id, poids_actuel_kg) VALUES
    ('TAG-001', 'Baaba',    1, 'F', '2023-01-15', 'actif', NULL, NULL, 310.00),  -- id=1 mère
    ('TAG-002', 'Samba',    1, 'M', '2022-06-10', 'actif', NULL, NULL, 380.00),  -- id=2 père
    ('TAG-003', 'Fatou',    2, 'F', '2023-03-20', 'actif', NULL, NULL, 255.00),  -- id=3
    ('TAG-004', 'Modou',    2, 'M', '2023-09-05', 'actif', NULL, NULL, 290.00),  -- id=4
    ('TAG-005', 'Coumba',   1, 'F', '2021-11-01', 'vendu', NULL, NULL, 320.00),  -- id=5 vendu
    ('TAG-006', 'Petit-Bo', 1, 'M', '2025-11-20', 'actif', NULL, NULL, 48.00);  -- id=6 veau (< 6 mois, < 60 kg)

-- Mise à jour généalogie : TAG-006 est le fils de TAG-001 (Baaba) et TAG-002 (Samba)
UPDATE animaux SET mere_id = 1, pere_id = 2 WHERE id = 6;

-- --- Pesées (historique pour tester fn_gmq) ----------------------------------
-- TAG-001 (Baaba) : 3 pesées sur 90 jours
INSERT INTO pesees (animal_id, poids_kg, date_pesee, agent) VALUES
    (1, 280.00, '2024-01-10', 'Dr. Diallo'),
    (1, 295.00, '2024-04-10', 'Dr. Diallo'),
    (1, 310.00, '2024-07-10', 'BoviBot');

-- TAG-006 (Petit-Bo) : 2 pesées pour tester alerte poids critique
INSERT INTO pesees (animal_id, poids_kg, date_pesee, agent) VALUES
    (6, 42.00, '2025-12-01', 'Dr. Diallo'),
    (6, 48.00, '2026-01-15', 'BoviBot');

-- --- Santé (3 actes dont 1 avec prochain_rdv dépassé) -----------------------
INSERT INTO sante (animal_id, type, description, date_acte, veterinaire, prochain_rdv) VALUES
    (1, 'vaccination',  'Vaccin FMDV Sérotypes O/A',     '2025-06-01', 'Dr. Diallo',  '2026-06-01'),
    (3, 'vaccination',  'Vaccin péripneumonie bovine',   '2024-09-15', 'Dr. Diallo',  '2025-09-15'),  -- prochain_rdv dépassé
    (4, 'contrôle',     'Bilan de santé annuel',          '2026-01-20', 'Dr. Sow',     NULL);

-- --- Reproduction (1 gestation en cours) ------------------------------------
INSERT INTO reproduction (mere_id, pere_id, date_saillie, date_velage_prevue, statut) VALUES
    (3, 2, '2026-01-10', '2026-10-20', 'en_cours');

-- --- Alimentation (2 rations) -----------------------------------------------
INSERT INTO alimentation (animal_id, type_aliment, quantite_kg, cout_unitaire_kg, date_ration) VALUES
    (1, 'Foin de brousse',   5.50, 150.00, '2026-04-01'),
    (2, 'Concentré protéiné', 2.00, 500.00, '2026-04-01');

-- --- Ventes (1 vente existante pour TAG-005) ---------------------------------
INSERT INTO ventes (animal_id, acheteur, telephone, prix_fcfa, poids_vente_kg, date_vente) VALUES
    (5, 'Ibrahima Ndiaye', '+221771234567', 320000.00, 325.00, '2025-12-15');


-- =============================================================================
-- SECTION 6 : REQUÊTES DE VÉRIFICATION (à exécuter manuellement pour tester)
-- =============================================================================

-- -- Test 1 : Âge de chaque animal en mois
-- SELECT id, numero_tag, nom, date_naissance,
--        fn_age_en_mois(id) AS age_mois
-- FROM animaux
-- ORDER BY date_naissance;

-- -- Test 2 : GMQ de chaque animal
-- SELECT id, numero_tag, nom,
--        fn_gmq(id) AS gmq_kg_par_jour
-- FROM animaux
-- ORDER BY id;

-- -- Test 3 : Animaux actifs avec âge et GMQ (requête LLM type consultation)
-- SELECT a.numero_tag, a.nom, fn_age_en_mois(a.id) AS age_mois,
--        fn_gmq(a.id) AS gmq
-- FROM animaux a
-- WHERE a.statut = 'actif'
-- HAVING gmq < 0.3 OR gmq = 0.000;

-- -- Test 4 : Enregistrement d'une pesée via procédure (Mode ACTION - après confirmation)
-- CALL sp_enregistrer_pesee(1, 325.00, CURDATE(), 'BoviBot');

-- -- Test 5 : Vente d'un animal actif (Mode ACTION - après confirmation)
-- CALL sp_declarer_vente(4, 'Oumar Ba', '+221770001234', 280000.00, 290.00, CURDATE());

-- -- Test 6 : Vérification du cas limite (animal déjà vendu) → doit lever SQLSTATE '45000'
-- CALL sp_declarer_vente(5, 'Test Acheteur', NULL, 100000.00, NULL, CURDATE());

-- -- Test 7 : Pesée d'un veau sous-pondéral → doit créer une alerte critique
-- CALL sp_enregistrer_pesee(6, 50.00, CURDATE(), 'BoviBot');
-- SELECT * FROM alertes WHERE niveau = 'critique' ORDER BY created_at DESC LIMIT 5;

-- =============================================================================
-- FIN DU FICHIER schema.sql
-- =============================================================================
