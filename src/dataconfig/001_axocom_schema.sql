-- MySQL dump 10.13  Distrib 8.0.42, for Linux (x86_64)
--
-- Host: axolotldb.mysql.database.azure.com    Database: axocom
-- ------------------------------------------------------
-- Server version	8.0.46-azure

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Table structure for table `candidates`
--

DROP TABLE IF EXISTS `candidates`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `candidates` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL,
  `caste` varchar(255) DEFAULT NULL,
  `gender` varchar(10) DEFAULT NULL,
  `so_do_wo` varchar(255) DEFAULT NULL,
  `age` int NOT NULL,
  `candidate_image` varchar(255) DEFAULT NULL,
  `assembly_constituency` varchar(255) NOT NULL,
  `party` varchar(255) NOT NULL,
  `name_enrolled_as_voter_in` varchar(255) NOT NULL,
  `self_profession` varchar(255) DEFAULT NULL,
  `spouse_profession` varchar(255) DEFAULT NULL,
  `education_history` json DEFAULT NULL,
  `education_category` varchar(255) DEFAULT NULL,
  `university_name` varchar(255) DEFAULT NULL,
  `source_of_income` json DEFAULT NULL,
  `contracts` json DEFAULT NULL,
  `social_profiles` json DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=1164 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `constituency`
--

DROP TABLE IF EXISTS `constituency`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `constituency` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL,
  `state` varchar(255) NOT NULL,
  `ac_number` int NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=71 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `election`
--

DROP TABLE IF EXISTS `election`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `election` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL,
  `start_date` datetime NOT NULL,
  `end_date` datetime NOT NULL,
  `year` int NOT NULL,
  `constituency_id` int NOT NULL,
  `type` varchar(255) NOT NULL,
  `total_voters` int NOT NULL,
  `male_voters` int NOT NULL,
  `female_voters` int NOT NULL,
  `number_of_polling_stations` int NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `constituency_id` (`constituency_id`),
  CONSTRAINT `election_ibfk_1` FOREIGN KEY (`constituency_id`) REFERENCES `constituency` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=141 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `election_candidate`
--

DROP TABLE IF EXISTS `election_candidate`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `election_candidate` (
  `id` int NOT NULL AUTO_INCREMENT,
  `year` int NOT NULL,
  `assets` bigint NOT NULL,
  `liabilities` bigint NOT NULL,
  `criminal_cases` int NOT NULL,
  `pan_itr` json DEFAULT NULL,
  `details_of_criminal_cases` json DEFAULT NULL,
  `details_of_movable_assets` json DEFAULT NULL,
  `details_of_immovable_assets` json DEFAULT NULL,
  `details_of_liabilities` json DEFAULT NULL,
  `election_id` int NOT NULL,
  `candidate_id` int NOT NULL,
  `constituency_id` int NOT NULL,
  `party_id` int NOT NULL,
  `votes_polled` int NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `election_id` (`election_id`),
  KEY `candidate_id` (`candidate_id`),
  KEY `constituency_id` (`constituency_id`),
  KEY `party_id` (`party_id`),
  CONSTRAINT `election_candidate_ibfk_1` FOREIGN KEY (`election_id`) REFERENCES `election` (`id`),
  CONSTRAINT `election_candidate_ibfk_2` FOREIGN KEY (`candidate_id`) REFERENCES `candidates` (`id`),
  CONSTRAINT `election_candidate_ibfk_3` FOREIGN KEY (`constituency_id`) REFERENCES `constituency` (`id`),
  CONSTRAINT `election_candidate_ibfk_4` FOREIGN KEY (`party_id`) REFERENCES `party` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=1241 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `election_result`
--

DROP TABLE IF EXISTS `election_result`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `election_result` (
  `id` int NOT NULL AUTO_INCREMENT,
  `election_candidate_id` int NOT NULL,
  `votes_polled` int NOT NULL,
  `position` int NOT NULL,
  `status` varchar(255) NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `election_candidate_id` (`election_candidate_id`),
  CONSTRAINT `election_result_ibfk_1` FOREIGN KEY (`election_candidate_id`) REFERENCES `election_candidate` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=1245 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `flag_data`
--

DROP TABLE IF EXISTS `flag_data`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `flag_data` (
  `id` int NOT NULL AUTO_INCREMENT,
  `data` json NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `email` varchar(255) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `mentor_applications`
--

DROP TABLE IF EXISTS `mentor_applications`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `mentor_applications` (
  `id` varchar(255) NOT NULL,
  `full_name` varchar(255) NOT NULL,
  `email` varchar(255) NOT NULL,
  `normalized_email` varchar(255) NOT NULL,
  `phone` varchar(50) NOT NULL,
  `normalized_phone` varchar(20) NOT NULL,
  `current_role` varchar(255) NOT NULL,
  `organisation` varchar(255) DEFAULT NULL,
  `expertise` text NOT NULL,
  `experience_summary` text NOT NULL,
  `motivation` text NOT NULL,
  `profile_url` text,
  `contact_consent_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `status` enum('pending','accepted','rejected') NOT NULL DEFAULT 'pending',
  `admin_note` text,
  `reviewed_at` timestamp NULL DEFAULT NULL,
  `reviewed_by_admin_id` int DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_mentor_normalized_email` (`normalized_email`),
  UNIQUE KEY `unique_mentor_normalized_phone` (`normalized_phone`),
  KEY `idx_mentor_status` (`status`),
  KEY `idx_mentor_created_at` (`created_at`),
  KEY `fk_mentor_reviewer` (`reviewed_by_admin_id`),
  CONSTRAINT `fk_mentor_reviewer` FOREIGN KEY (`reviewed_by_admin_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `party`
--

DROP TABLE IF EXISTS `party`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `party` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL,
  `symbol` varchar(255) NOT NULL,
  `short_name` varchar(255) NOT NULL,
  `party_type` varchar(255) NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=63 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `solution_submissions`
--

DROP TABLE IF EXISTS `solution_submissions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `solution_submissions` (
  `id` varchar(255) NOT NULL,
  `full_name` varchar(255) NOT NULL,
  `email` varchar(255) NOT NULL,
  `normalized_email` varchar(255) NOT NULL,
  `phone` varchar(50) NOT NULL,
  `normalized_phone` varchar(20) NOT NULL,
  `problem_code` varchar(100) NOT NULL,
  `solution_title` varchar(255) NOT NULL,
  `solution_description` text NOT NULL,
  `prototype_url` text,
  `contact_consent_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `status` enum('pending','accepted','rejected') NOT NULL DEFAULT 'pending',
  `admin_note` text,
  `reviewed_at` timestamp NULL DEFAULT NULL,
  `reviewed_by_admin_id` int DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_solution_normalized_email` (`normalized_email`),
  UNIQUE KEY `unique_solution_normalized_phone` (`normalized_phone`),
  KEY `idx_solution_status` (`status`),
  KEY `idx_solution_created_at` (`created_at`),
  KEY `idx_solution_problem_code` (`problem_code`),
  KEY `fk_solution_reviewer` (`reviewed_by_admin_id`),
  CONSTRAINT `fk_solution_reviewer` FOREIGN KEY (`reviewed_by_admin_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `users`
--

DROP TABLE IF EXISTS `users`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `users` (
  `id` int NOT NULL AUTO_INCREMENT,
  `email` varchar(255) NOT NULL,
  `password_hash` varchar(255) NOT NULL,
  `name` varchar(255) DEFAULT NULL,
  `is_admin` tinyint(1) NOT NULL DEFAULT '0',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `default_assembly_constituency` varchar(255) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `email` (`email`),
  KEY `idx_email` (`email`)
) ENGINE=InnoDB AUTO_INCREMENT=8 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `voter_details`
--

DROP TABLE IF EXISTS `voter_details`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `voter_details` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `epic_number` varchar(50) NOT NULL,
  `first_name_english` varchar(255) NOT NULL,
  `first_name_local` varchar(255) DEFAULT NULL,
  `last_name_english` varchar(255) DEFAULT NULL,
  `last_name_local` varchar(255) DEFAULT NULL,
  `gender` varchar(10) NOT NULL,
  `age` int NOT NULL,
  `relative_first_name_english` varchar(255) DEFAULT NULL,
  `relative_first_name_local` varchar(255) DEFAULT NULL,
  `relative_last_name_english` varchar(255) DEFAULT NULL,
  `relative_last_name_local` varchar(255) DEFAULT NULL,
  `state` varchar(255) NOT NULL,
  `parliamentary_constituency` varchar(255) NOT NULL,
  `assembly_constituency` varchar(255) NOT NULL,
  `polling_station` varchar(500) NOT NULL,
  `part_number_name` varchar(255) NOT NULL,
  `part_serial_number` int NOT NULL,
  `fetch_status` varchar(50) NOT NULL,
  `fetch_attempts` int DEFAULT '0',
  `error_message` text,
  `last_attempt` datetime NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `epic_number` (`epic_number`),
  KEY `idx_epic_number` (`epic_number`)
) ENGINE=InnoDB AUTO_INCREMENT=8368219 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping events for database 'axocom'
--

--
-- Dumping routines for database 'axocom'
--
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-08-28 11:36:05
