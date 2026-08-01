-- MySQL dump 10.13  Distrib 8.4.7, for Linux (aarch64)
--
-- Host: localhost    Database: axocom
-- ------------------------------------------------------
-- Server version	8.4.7

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
  `so_do_wo` varchar(255) DEFAULT NULL,
  `age` int NOT NULL,
  `candidate_image` varchar(255) DEFAULT NULL,
  `assembly_constituency` varchar(255) NOT NULL,
  `party` varchar(255) NOT NULL,
  `name_enrolled_as_voter_in` varchar(255) NOT NULL,
  `self_profession` varchar(255) DEFAULT NULL,
  `spouse_profession` varchar(255) DEFAULT NULL,
  `education_category` varchar(255) DEFAULT NULL,
  `university_name` varchar(255) DEFAULT NULL,
  `education_history` json DEFAULT NULL,
  `source_of_income` json DEFAULT NULL,
  `contracts` json DEFAULT NULL,
  `social_profiles` json DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `candidates`
--

LOCK TABLES `candidates` WRITE;
/*!40000 ALTER TABLE `candidates` DISABLE KEYS */;
INSERT INTO `candidates` VALUES (1,'Sowmya Reddy','OBC','D/O Ramalinga Reddy',36,NULL,'Bangalore South','INC','Jayanagar','Social Worker','Business','Graduate','Christ University','[{\"degree\": \"M.A. Political Science\", \"status\": \"Completed\", \"institution\": \"Banaras Hindu University\", \"passing_year\": 1994}, {\"degree\": \"B.A. (Hons) Political Science\", \"status\": \"Completed\", \"institution\": \"Banaras Hindu University\", \"passing_year\": 1992}, {\"degree\": \"Senior Secondary (Class XII)\", \"status\": \"Completed\", \"institution\": \"U.P. Board Allahabad\", \"passing_year\": 1989}]','[\"Agriculture Income\", \"Business Income\"]','[]','{\"twitter\": \"https://twitter.com/sowmyareddy\"}','2026-02-21 06:07:24'),(2,'Raghav Sharma','General','S/O Mahesh Sharma',48,NULL,'Bangalore South','BJP','Jayanagar','Businessman','Homemaker','Post Graduate','Bangalore University',NULL,'[\"Business Income\"]','[]','{\"twitter\": \"https://twitter.com/raghavsharma\"}','2026-02-21 06:21:50'),(3,'Anita Rao','OBC','W/O Srinivas Rao',42,NULL,'Bangalore South','JDS','Basavanagudi','Advocate','Engineer','Graduate','National Law School',NULL,'[\"Legal Practice\"]','[]','{\"facebook\": \"https://facebook.com/anitarao\"}','2026-02-21 06:21:50');
/*!40000 ALTER TABLE `candidates` ENABLE KEYS */;
UNLOCK TABLES;

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
  `number_of_polling_stations` int NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `constituency`
--

LOCK TABLES `constituency` WRITE;
/*!40000 ALTER TABLE `constituency` DISABLE KEYS */;
INSERT INTO `constituency` VALUES (1,'Bangalore South','Karnataka',178,245,'2026-02-21 06:07:59');
/*!40000 ALTER TABLE `constituency` ENABLE KEYS */;
UNLOCK TABLES;

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
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `constituency_id` (`constituency_id`),
  CONSTRAINT `election_ibfk_1` FOREIGN KEY (`constituency_id`) REFERENCES `constituency` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `election`
--

LOCK TABLES `election` WRITE;
/*!40000 ALTER TABLE `election` DISABLE KEYS */;
INSERT INTO `election` VALUES (1,'Karnataka Assembly Election 2024','2024-04-01 00:00:00','2024-05-01 00:00:00',2024,1,'Assembly',245000,124000,121000,'2026-02-21 06:08:43'),(2,'Karnataka Assembly Election 2019','2019-04-01 00:00:00','2019-05-01 00:00:00',2019,1,'Assembly',230000,116000,114000,'2026-02-21 06:24:36');
/*!40000 ALTER TABLE `election` ENABLE KEYS */;
UNLOCK TABLES;

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
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `election_candidate`
--

LOCK TABLES `election_candidate` WRITE;
/*!40000 ALTER TABLE `election_candidate` DISABLE KEYS */;
INSERT INTO `election_candidate` VALUES (1,2024,420000000,5000000,1,'[{\"pan_given\": \"Y\", \"relation_type\": \"self\", \"financial_year\": \"2020 - 2021\", \"total_income_shown_in_itr\": \"Rs 8,95,814\"}, {\"pan_given\": \"Y\", \"relation_type\": \"spouse\", \"financial_year\": \"2020 - 2021\", \"total_income_shown_in_itr\": \"Rs 22,17,643\"}, {\"pan_given\": \"N\", \"relation_type\": \"huf\", \"financial_year\": \"None\", \"total_income_shown_in_itr\": \"Rs 0\"}]','[{\"type\": \"pending_case\", \"col_1\": \"Serial No.\", \"col_2\": \"FIR No.\", \"col_3\": \"Case No.\", \"col_4\": \"Court\", \"col_5\": \"IPC Sections Applicable\"}, {\"type\": \"pending_case\", \"col_1\": \"1\", \"col_2\": \"478/2021, PS Bajpur Udham Singh Nagar\", \"col_5\": \"147, 323, 504, 506\"}, {\"type\": \"convicted_case\", \"col_1\": \"-- No Cases --\"}]','[{\"col_1\": \"i\", \"col_2\": \"Cash\", \"col_3\": \"50,000\", \"col_4\": \"10,000\", \"col_9\": \"Rs 60,000\"}, {\"col_1\": \"ii\", \"col_2\": \"Bank Deposits\", \"col_3\": \"2,70,004\", \"col_4\": \"30,00,000\", \"col_9\": \"Rs 60,44,686\"}, {\"col_1\": \"Totals\", \"col_2\": \"Rs 47,27,486\", \"col_3\": \"Rs 2,39,58,498\", \"col_8\": \"Rs 2,86,85,984\"}]','[{\"col_1\": \"i\", \"col_2\": \"Agricultural Land\", \"col_3\": \"Village Bin 15 Muthhi\", \"col_4\": \"Village Sirar Lacher 60 Nali\", \"col_9\": \"Rs 0\"}, {\"col_1\": \"iv\", \"col_2\": \"Residential Buildings\", \"col_3\": \"Haldwani 1,50,00,000\", \"col_4\": \"Suprime Residential 4,00,00,000\", \"col_9\": \"Rs 6,75,00,000\"}, {\"col_1\": \"Totals\", \"col_2\": \"Rs 2,25,00,000\", \"col_3\": \"Rs 4,50,00,000\", \"col_8\": \"Rs 6,75,00,000\"}]','[{\"col_1\": \"i\", \"col_2\": \"Loans from Banks\", \"col_3\": \"11,68,774\", \"col_4\": \"50,00,000\", \"col_9\": \"Rs 2,00,38,149\"}, {\"col_1\": \"Totals\", \"col_2\": \"Rs 50,38,149\", \"col_3\": \"Rs 1,50,00,000\", \"col_8\": \"Rs 2,00,38,149\"}]',1,1,1,1,85000,'2026-02-21 06:15:55'),(2,2024,780000000,12000000,0,'[{\"pan_given\": \"Y\", \"relation_type\": \"self\", \"financial_year\": \"2022-23\", \"total_income_shown_in_itr\": \"Rs 35,00,000\"}]','[{\"type\": \"pending_case\", \"col_1\": \"-- No Cases --\"}]','[{\"col_1\": \"i\", \"col_2\": \"Cash\", \"col_3\": \"2,00,000\", \"col_9\": \"Rs 2,00,000\"}]','[{\"col_1\": \"i\", \"col_2\": \"Residential Property\", \"col_3\": \"Bangalore 3,50,00,000\", \"col_9\": \"Rs 3,50,00,000\"}]','[{\"col_1\": \"i\", \"col_2\": \"Bank Loan\", \"col_3\": \"Rs 12,00,000\"}]',1,2,1,2,95000,'2026-02-21 06:22:12'),(3,2024,150000000,2000000,1,'[{\"pan_given\": \"Y\", \"relation_type\": \"self\", \"financial_year\": \"2022-23\", \"total_income_shown_in_itr\": \"Rs 18,00,000\"}]','[{\"type\": \"pending_case\", \"col_1\": \"1\", \"col_2\": \"FIR 123/2020\", \"col_5\": \"IPC 188\"}]','[{\"col_1\": \"i\", \"col_2\": \"Cash\", \"col_3\": \"1,50,000\", \"col_9\": \"Rs 1,50,000\"}]','[{\"col_1\": \"i\", \"col_2\": \"Agricultural Land\", \"col_3\": \"Mandya 1,20,00,000\", \"col_9\": \"Rs 1,20,00,000\"}]','[{\"col_1\": \"i\", \"col_2\": \"Personal Loan\", \"col_3\": \"Rs 20,00,000\"}]',1,3,1,3,42000,'2026-02-21 06:22:22'),(4,2019,180000000,2000000,0,'[{\"pan_given\": \"Y\", \"relation_type\": \"self\", \"financial_year\": \"2018-19\", \"total_income_shown_in_itr\": \"Rs 12,00,000\"}]','[{\"type\": \"pending_case\", \"col_1\": \"-- No Cases --\"}]','[{\"col_1\": \"i\", \"col_2\": \"Cash\", \"col_3\": \"80,000\", \"col_9\": \"Rs 80,000\"}]','[{\"col_1\": \"i\", \"col_2\": \"Residential Property\", \"col_3\": \"Bangalore 1,20,00,000\", \"col_9\": \"Rs 1,20,00,000\"}]','[{\"col_1\": \"i\", \"col_2\": \"Bank Loan\", \"col_3\": \"Rs 20,00,000\"}]',2,1,1,1,62000,'2026-02-21 06:24:42');
/*!40000 ALTER TABLE `election_candidate` ENABLE KEYS */;
UNLOCK TABLES;

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
) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `election_result`
--

LOCK TABLES `election_result` WRITE;
/*!40000 ALTER TABLE `election_result` DISABLE KEYS */;
INSERT INTO `election_result` VALUES (1,1,85000,1,'Won','2026-02-21 06:16:36'),(2,2,95000,1,'Won','2026-02-21 06:22:35'),(3,1,85000,2,'Lost','2026-02-21 06:22:35'),(4,3,42000,3,'Lost','2026-02-21 06:22:35'),(5,4,62000,2,'Lost','2026-02-21 06:24:58');
/*!40000 ALTER TABLE `election_result` ENABLE KEYS */;
UNLOCK TABLES;

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
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `party`
--

LOCK TABLES `party` WRITE;
/*!40000 ALTER TABLE `party` DISABLE KEYS */;
INSERT INTO `party` VALUES (1,'Indian National Congress','Hand','INC','National','2026-02-21 06:08:19'),(2,'Bharatiya Janata Party','Lotus','BJP','National','2026-02-21 06:18:36'),(3,'Aam Aadmi Party','Broom','AAP','State','2026-02-21 06:18:36');
/*!40000 ALTER TABLE `party` ENABLE KEYS */;
UNLOCK TABLES;

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
  `name` varchar(255) NOT NULL,
  `is_admin` tinyint(1) NOT NULL DEFAULT '0',
  `default_assembly_constituency` varchar(255) NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `email` (`email`),
  KEY `idx_email` (`email`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--

LOCK TABLES `users` WRITE;
/*!40000 ALTER TABLE `users` DISABLE KEYS */;
INSERT INTO `users` VALUES (1,'user@example.com','$2a$12$NKmNtEFkcu.CyhGsD1EBXO69CtGQnNjfHPZDXEHwTX4BcHebTxUC2','Test',0,'Bangalore South','2026-01-31 07:03:52','2026-01-31 07:03:52');
INSERT INTO `users` VALUES (2,'user@example2.com','$2a$12$NKmNtEFkcu.CyhGsD1EBXO69CtGQnNjfHPZDXEHwTX4BcHebTxUC2','Test',1,'Bangalore South','2026-01-31 07:03:52','2026-01-31 07:03:52');

/*!40000 ALTER TABLE `users` ENABLE KEYS */;
UNLOCK TABLES;

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
  `polling_station` varchar(255) NOT NULL,
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
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `voter_details`
--

LOCK TABLES `voter_details` WRITE;
/*!40000 ALTER TABLE `voter_details` DISABLE KEYS */;
INSERT INTO `voter_details` VALUES (1,'ABC1234567','Rahul','राहुल','Sharma','शर्मा','Male',34,'Mahesh','महेश','Sharma','शर्मा','Maharashtra','Mumbai North','Andheri East','Municipal School No. 12','Part-45',128,'SUCCESS',1,NULL,'2026-01-29 16:13:20','2026-01-29 16:13:20');
/*!40000 ALTER TABLE `voter_details` ENABLE KEYS */;
UNLOCK TABLES;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-02-28  6:35:58
