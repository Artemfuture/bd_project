--
-- Database: deanery  (Virtual Deanery - student achievements and rating)
-- Run inside an empty database named "deanery":  CREATE DATABASE deanery;
-- Requires PostgreSQL 13+ (extension btree_gist).
--

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: btree_gist; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA public;


--
-- Name: EXTENSION btree_gist; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION btree_gist IS 'support for indexing common datatypes in GiST';


--
-- Name: check_achievement_confirmation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_achievement_confirmation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    reviewer_type varchar(30);
BEGIN

    IF NEW.status NOT IN (
        'confirmed',
        'rejected'
    ) THEN
        RETURN NEW;
    END IF;

    IF NEW.verified_by IS NULL THEN
        RAISE EXCEPTION
            'The employee who reviewed the achievement is not specified';
    END IF;

    SELECT role_type
    INTO reviewer_type
    FROM employee
    WHERE employee_id =
          NEW.verified_by;

    IF reviewer_type <> 'deanery staff' THEN
        RAISE EXCEPTION
            'Only deanery staff can review achievements';
    END IF;

    IF NEW.verified_at IS NULL THEN
        RAISE EXCEPTION
            'The review date is not specified';
    END IF;

    IF NEW.status = 'confirmed' THEN

        IF NOT EXISTS (
            SELECT 1
            FROM supporting_document
            WHERE achievement_id =
                  NEW.achievement_id
        )
        THEN

            RAISE EXCEPTION
                'An achievement cannot be confirmed without a supporting document';

        END IF;

    END IF;

    RETURN NEW;
END;
$$;


--
-- Name: check_achievement_subtype_kind(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_achievement_subtype_kind() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    expected_kind varchar(20);
    actual_kind varchar(20);
BEGIN

    CASE TG_TABLE_NAME

        WHEN 'achievement_event' THEN
            expected_kind := 'participation';

        WHEN 'achievement_authorship' THEN
            expected_kind := 'authorship';

        WHEN 'achievement_membership' THEN
            expected_kind := 'membership';

        ELSE
            RAISE EXCEPTION
                'Unknown achievement subtype';

    END CASE;

    SELECT kind
    INTO actual_kind
    FROM achievement
    WHERE achievement_id =
          NEW.achievement_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'Parent achievement not found';
    END IF;

    IF actual_kind <> expected_kind THEN

        RAISE EXCEPTION
            'Achievement kind "%" does not match table "%"',
            actual_kind,
            TG_TABLE_NAME;

    END IF;

    RETURN NEW;
END;
$$;


--
-- Name: check_event_cycle(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_event_cycle() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN

    IF NEW.parent_event_id IS NULL THEN
        RETURN NEW;
    END IF;

    IF EXISTS (
        WITH RECURSIVE ancestors AS (

            SELECT
                ev.event_id,
                ev.parent_event_id,
                ARRAY[ev.event_id] AS path

            FROM event ev

            WHERE ev.event_id =
                  NEW.parent_event_id

            UNION ALL

            SELECT
                ev.event_id,
                ev.parent_event_id,
                p.path || ev.event_id

            FROM event ev

            JOIN ancestors p
                ON ev.event_id =
                   p.parent_event_id

            WHERE NOT (
                ev.event_id =
                ANY(p.path)
            )
        )

        SELECT 1
        FROM ancestors
        WHERE event_id =
              NEW.event_id
    )
    THEN

        RAISE EXCEPTION
            'Cannot create a cycle in the event hierarchy';

    END IF;

    RETURN NEW;
END;
$$;


--
-- Name: check_student_status_on_achievement(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_student_status_on_achievement() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    current_status varchar(20);
BEGIN

    SELECT status
    INTO current_status
    FROM student
    WHERE student_id =
          NEW.student_id;

    IF current_status = 'expelled' THEN

        RAISE EXCEPTION
            'Cannot add a new achievement for an expelled student';

    END IF;

    RETURN NEW;
END;
$$;


--
-- Name: check_supervisor(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_supervisor() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    emp_type varchar(30);
BEGIN

    IF NEW.supervisor_id IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT role_type
    INTO emp_type
    FROM employee
    WHERE employee_id =
          NEW.supervisor_id;

    IF emp_type <> 'lecturer' THEN

        RAISE EXCEPTION
            'Only a lecturer can be a scientific supervisor';

    END IF;

    RETURN NEW;
END;
$$;


--
-- Name: confirm_achievement(integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.confirm_achievement(p_achievement_id integer, p_reviewer_id integer) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_kind varchar(20);
    v_category integer;
    v_date date;

    v_level integer;
    v_role integer;
    v_result varchar(20);

    v_rule integer;
    v_points numeric(6,2);

    v_employee_type varchar(30);
BEGIN

    /* Check the employee */

    SELECT role_type
    INTO v_employee_type
    FROM employee
    WHERE employee_id =
          p_reviewer_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'Employee with id % not found',
            p_reviewer_id;
    END IF;

    IF v_employee_type <> 'deanery staff' THEN
        RAISE EXCEPTION
            'Only deanery staff can confirm achievements';
    END IF;

    /* Fetch the achievement itself */

    SELECT
        kind,
        category_id,
        achieved_on
    INTO
        v_kind,
        v_category,
        v_date
    FROM achievement
    WHERE achievement_id =
          p_achievement_id
      AND status = 'under review';

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'Achievement not found or not under review';
    END IF;

    /* Check the supporting document */

    IF NOT EXISTS (
        SELECT 1
        FROM supporting_document
        WHERE achievement_id =
              p_achievement_id
    ) THEN
        RAISE EXCEPTION
            'The achievement has no supporting document';
    END IF;

    /* Determine achievement parameters by its subtype. */

    IF v_kind = 'participation' THEN

        SELECT
            ev.level_id,
            pt.role_id,
            pt.result
        INTO
            v_level,
            v_role,
            v_result
        FROM achievement_event pt
        JOIN event ev
            ON ev.event_id =
               pt.event_id
        WHERE pt.achievement_id =
              p_achievement_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION
                'No event participation data for the achievement';
        END IF;

    ELSIF v_kind = 'authorship' THEN

        SELECT
            src.level_id
        INTO
            v_level
        FROM achievement_authorship au
        JOIN publication p
            ON p.publication_id =
               au.publication_id
        JOIN publication_source src
            ON src.source_id =
               p.source_id
        WHERE au.achievement_id =
              p_achievement_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION
                'No publication authorship data for the achievement';
        END IF;

        v_role := NULL;
        v_result := NULL;

    ELSIF v_kind = 'membership' THEN

        IF NOT EXISTS (
            SELECT 1
            FROM achievement_membership
            WHERE achievement_id =
                  p_achievement_id
        ) THEN
            RAISE EXCEPTION
                'No membership data for the achievement';
        END IF;

        v_level := NULL;
        v_role := NULL;
        v_result := NULL;

    ELSE

        RAISE EXCEPTION
            'Unknown achievement kind: %',
            v_kind;

    END IF;

    /* Find the most specific matching rule. NULL in a rule means "any value". */

    SELECT
        sr.rule_id,
        sr.points
    INTO
        v_rule,
        v_points
    FROM scoring_rule sr
    WHERE sr.kind = v_kind

      AND sr.category_id =
          v_category

      AND (
          sr.level_id IS NULL
          OR sr.level_id =
             v_level
      )

      AND (
          sr.role_id IS NULL
          OR sr.role_id =
             v_role
      )

      AND (
          sr.result IS NULL
          OR sr.result =
             v_result
      )

      AND sr.valid_from <= v_date

      AND (
          sr.valid_to IS NULL
          OR sr.valid_to >= v_date
      )

    ORDER BY
        (
            CASE
                WHEN sr.level_id IS NOT NULL
                THEN 1 ELSE 0
            END
            +
            CASE
                WHEN sr.role_id IS NOT NULL
                THEN 1 ELSE 0
            END
            +
            CASE
                WHEN sr.result IS NOT NULL
                THEN 1 ELSE 0
            END
        ) DESC,

        sr.valid_from DESC,
        sr.rule_id DESC

    LIMIT 1;

    IF v_rule IS NULL THEN
        RAISE EXCEPTION
            'No suitable scoring rule found for the achievement';
    END IF;

    /* Confirm */

    UPDATE achievement
    SET
        status = 'confirmed',
        points = v_points,
        rule_id = v_rule,
        verified_by =
            p_reviewer_id,
        verified_at = now()
    WHERE achievement_id =
          p_achievement_id;

END;
$$;


--
-- Name: recalculate_period_rating(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.recalculate_period_rating(p_period_id integer) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN

    IF NOT EXISTS (
        SELECT 1
        FROM academic_period
        WHERE period_id =
              p_period_id
    ) THEN
        RAISE EXCEPTION
            'Academic period with id % not found',
            p_period_id;
    END IF;

    /* Sum of confirmed achievements for each student. */

    INSERT INTO student_rating (
        student_id,
        period_id,
        total_points,
        calculated_at
    )

    SELECT
        s.student_id,
        p_period_id,

        COALESCE(
            SUM(a.points)
                FILTER (
                    WHERE a.status = 'confirmed'
                ),
            0
        ),

        now()

    FROM student s

    LEFT JOIN achievement a
        ON a.student_id =
           s.student_id
       AND a.period_id =
           p_period_id

    GROUP BY
        s.student_id

    ON CONFLICT (
        student_id,
        period_id
    )

    DO UPDATE SET
        total_points =
            EXCLUDED.total_points,

        calculated_at =
            now();

    /* Rank within the study group. */

    WITH computed_ranks AS (
        SELECT
            r.rating_id,

            RANK() OVER (
                PARTITION BY
                    s.group_id

                ORDER BY
                    r.total_points DESC
            )::integer AS rank_no

        FROM student_rating r

        JOIN student s
            ON s.student_id =
               r.student_id

        WHERE r.period_id =
              p_period_id
    )

    UPDATE student_rating r
    SET rank_in_group =
        computed_ranks.rank_no

    FROM computed_ranks

    WHERE r.rating_id =
          computed_ranks.rating_id;

    /* Rank within the study direction. */

    WITH computed_ranks AS (
        SELECT
            r.rating_id,

            RANK() OVER (
                PARTITION BY
                    g.direction_id

                ORDER BY
                    r.total_points DESC
            )::integer AS rank_no

        FROM student_rating r

        JOIN student s
            ON s.student_id =
               r.student_id

        JOIN study_group g
            ON g.group_id =
               s.group_id

        WHERE r.period_id =
              p_period_id
    )

    UPDATE student_rating r
    SET rank_in_direction =
        computed_ranks.rank_no

    FROM computed_ranks

    WHERE r.rating_id =
          computed_ranks.rating_id;

END;
$$;


--
-- Name: recalculate_rating_trigger(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.recalculate_rating_trigger() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN

    IF TG_OP = 'DELETE' THEN

        PERFORM recalculate_period_rating(
            OLD.period_id
        );

        RETURN OLD;

    END IF;

    IF TG_OP = 'UPDATE'
       AND OLD.period_id <>
           NEW.period_id
    THEN

        PERFORM recalculate_period_rating(
            OLD.period_id
        );

        PERFORM recalculate_period_rating(
            NEW.period_id
        );

        RETURN NEW;

    END IF;

    PERFORM recalculate_period_rating(
        NEW.period_id
    );

    RETURN NEW;

END;
$$;


--
-- Name: reject_achievement(integer, integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reject_achievement(p_achievement_id integer, p_reviewer_id integer, p_comment text) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_type varchar(30);
BEGIN

    SELECT role_type
    INTO v_type
    FROM employee
    WHERE employee_id =
          p_reviewer_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'Employee not found';
    END IF;

    IF v_type <> 'deanery staff' THEN
        RAISE EXCEPTION
            'Only deanery staff can reject achievements';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM achievement
        WHERE achievement_id =
              p_achievement_id
          AND status = 'under review'
    ) THEN
        RAISE EXCEPTION
            'Achievement not found or not under review';
    END IF;

    IF p_comment IS NULL
       OR btrim(p_comment) = ''
    THEN
        RAISE EXCEPTION
            'A reason must be given when rejecting';
    END IF;

    UPDATE achievement
    SET
        status = 'rejected',
        points = NULL,
        rule_id = NULL,
        verified_by =
            p_reviewer_id,
        verified_at = now(),
        reviewer_comment =
            p_comment
    WHERE achievement_id =
          p_achievement_id;

END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: academic_period; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.academic_period (
    period_id integer NOT NULL,
    academic_year character varying(9) NOT NULL,
    semester smallint NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL,
    CONSTRAINT chk_academic_year CHECK (((academic_year)::text ~ '^\d{4}/\d{4}$'::text)),
    CONSTRAINT chk_period_dates CHECK ((end_date > start_date)),
    CONSTRAINT chk_semester CHECK ((semester = ANY (ARRAY[1, 2])))
);


--
-- Name: academic_period_period_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.academic_period ALTER COLUMN period_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.academic_period_period_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: achievement; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.achievement (
    achievement_id integer NOT NULL,
    kind character varying(20) NOT NULL,
    title character varying(255) NOT NULL,
    achieved_on date NOT NULL,
    status character varying(20) DEFAULT 'draft'::character varying NOT NULL,
    points numeric(6,2),
    verified_at timestamp with time zone,
    reviewer_comment text,
    student_id integer NOT NULL,
    category_id integer NOT NULL,
    period_id integer NOT NULL,
    rule_id integer,
    verified_by integer,
    CONSTRAINT chk_achievement_kind CHECK (((kind)::text = ANY (ARRAY[('participation'::character varying)::text, ('authorship'::character varying)::text, ('membership'::character varying)::text]))),
    CONSTRAINT chk_achievement_points CHECK (((points IS NULL) OR (points >= (0)::numeric))),
    CONSTRAINT chk_achievement_status CHECK (((status)::text = ANY (ARRAY[('draft'::character varying)::text, ('under review'::character varying)::text, ('confirmed'::character varying)::text, ('rejected'::character varying)::text]))),
    CONSTRAINT chk_confirmation_data CHECK (((((status)::text = 'confirmed'::text) AND (points IS NOT NULL) AND (rule_id IS NOT NULL) AND (verified_by IS NOT NULL) AND (verified_at IS NOT NULL)) OR (((status)::text <> 'confirmed'::text) AND (points IS NULL) AND (rule_id IS NULL))))
);


--
-- Name: achievement_achievement_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.achievement ALTER COLUMN achievement_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.achievement_achievement_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: achievement_authorship; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.achievement_authorship (
    achievement_id integer NOT NULL,
    student_id integer NOT NULL,
    publication_id integer NOT NULL,
    author_order smallint NOT NULL,
    CONSTRAINT chk_author_order CHECK ((author_order >= 1))
);


--
-- Name: achievement_category; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.achievement_category (
    category_id integer NOT NULL,
    name character varying(100) NOT NULL,
    description text
);


--
-- Name: achievement_category_category_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.achievement_category ALTER COLUMN category_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.achievement_category_category_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: achievement_event; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.achievement_event (
    achievement_id integer NOT NULL,
    student_id integer NOT NULL,
    event_id integer NOT NULL,
    role_id integer NOT NULL,
    result character varying(20) NOT NULL,
    CONSTRAINT chk_participation_result CHECK (((result)::text = ANY (ARRAY[('no place'::character varying)::text, ('3rd place'::character varying)::text, ('2nd place'::character varying)::text, ('1st place'::character varying)::text, ('grand prix'::character varying)::text])))
);


--
-- Name: employee; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee (
    employee_id integer NOT NULL,
    full_name character varying(150) NOT NULL,
    "position" character varying(100) NOT NULL,
    role_type character varying(30) NOT NULL,
    email character varying(254) NOT NULL,
    department_id integer,
    CONSTRAINT chk_role_type CHECK (((role_type)::text = ANY (ARRAY[('lecturer'::character varying)::text, ('deanery staff'::character varying)::text, ('administrator'::character varying)::text])))
);


--
-- Name: student; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.student (
    student_id integer NOT NULL,
    record_book_no character varying(20) NOT NULL,
    full_name character varying(150) NOT NULL,
    birth_date date NOT NULL,
    email character varying(254),
    status character varying(20) DEFAULT 'studying'::character varying NOT NULL,
    group_id integer NOT NULL,
    CONSTRAINT chk_birth_date CHECK ((birth_date >= '1930-01-01'::date)),
    CONSTRAINT chk_student_status CHECK (((status)::text = ANY (ARRAY[('studying'::character varying)::text, ('academic leave'::character varying)::text, ('expelled'::character varying)::text, ('graduate'::character varying)::text])))
);


--
-- Name: achievement_list; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.achievement_list AS
 SELECT a.achievement_id,
    a.title,
    a.kind,
    a.achieved_on,
    a.status,
    a.points,
    s.student_id,
    s.full_name AS student_name,
    s.record_book_no,
    c.name AS category_name,
    p.academic_year,
    p.semester,
    reviewer.full_name AS reviewer_name,
    a.verified_at,
    a.reviewer_comment
   FROM ((((public.achievement a
     JOIN public.student s ON ((s.student_id = a.student_id)))
     JOIN public.achievement_category c ON ((c.category_id = a.category_id)))
     JOIN public.academic_period p ON ((p.period_id = a.period_id)))
     LEFT JOIN public.employee reviewer ON ((reviewer.employee_id = a.verified_by)));


--
-- Name: achievement_membership; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.achievement_membership (
    achievement_id integer NOT NULL,
    student_id integer NOT NULL,
    organization_id integer NOT NULL,
    "position" character varying(100) DEFAULT 'participant'::character varying NOT NULL,
    joined_on date NOT NULL,
    left_on date,
    CONSTRAINT chk_membership_dates CHECK (((left_on IS NULL) OR (left_on >= joined_on)))
);


--
-- Name: department; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.department (
    department_id integer NOT NULL,
    name character varying(255) NOT NULL,
    short_name character varying(20) NOT NULL
);


--
-- Name: department_department_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.department ALTER COLUMN department_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.department_department_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: employee_employee_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.employee ALTER COLUMN employee_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.employee_employee_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: event; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.event (
    event_id integer NOT NULL,
    title character varying(255) NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL,
    place character varying(255),
    event_type_id integer NOT NULL,
    level_id integer NOT NULL,
    parent_event_id integer,
    organization_id integer,
    CONSTRAINT chk_event_dates CHECK ((end_date >= start_date)),
    CONSTRAINT chk_event_parent CHECK (((parent_event_id IS NULL) OR (parent_event_id <> event_id)))
);


--
-- Name: event_event_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.event ALTER COLUMN event_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.event_event_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: event_type; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.event_type (
    event_type_id integer NOT NULL,
    name character varying(100) NOT NULL
);


--
-- Name: event_type_event_type_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.event_type ALTER COLUMN event_type_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.event_type_event_type_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: organization; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organization (
    organization_id integer NOT NULL,
    name character varying(255) NOT NULL,
    org_type character varying(30) NOT NULL,
    founded_on date,
    is_active boolean DEFAULT true NOT NULL,
    curator_id integer,
    CONSTRAINT chk_org_type CHECK (((org_type)::text = ANY (ARRAY[('club'::character varying)::text, ('student council'::character varying)::text, ('scientific society'::character varying)::text, ('sports section'::character varying)::text, ('creative group'::character varying)::text])))
);


--
-- Name: organization_organization_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.organization ALTER COLUMN organization_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.organization_organization_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: participation_role; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.participation_role (
    role_id integer NOT NULL,
    name character varying(100) NOT NULL
);


--
-- Name: participation_role_role_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.participation_role ALTER COLUMN role_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.participation_role_role_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: publication; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.publication (
    publication_id integer NOT NULL,
    title character varying(255) NOT NULL,
    published_on date NOT NULL,
    doi character varying(100),
    pages character varying(20),
    source_id integer NOT NULL,
    supervisor_id integer
);


--
-- Name: publication_publication_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.publication ALTER COLUMN publication_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.publication_publication_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: publication_source; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.publication_source (
    source_id integer NOT NULL,
    name character varying(255) NOT NULL,
    issn character varying(9),
    source_type character varying(30) NOT NULL,
    level_id integer NOT NULL,
    CONSTRAINT chk_issn_format CHECK (((issn IS NULL) OR ((issn)::text ~ '^\d{4}-\d{3}[\dX]$'::text))),
    CONSTRAINT chk_source_type CHECK (((source_type)::text = ANY (ARRAY[('VAK journal'::character varying)::text, ('Scopus/WoS journal'::character varying)::text, ('RSCI journal'::character varying)::text, ('conference proceedings'::character varying)::text, ('other'::character varying)::text])))
);


--
-- Name: publication_source_source_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.publication_source ALTER COLUMN source_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.publication_source_source_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: student_rating; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.student_rating (
    rating_id integer NOT NULL,
    total_points numeric(7,2) DEFAULT 0 NOT NULL,
    rank_in_group integer,
    rank_in_direction integer,
    calculated_at timestamp with time zone DEFAULT now() NOT NULL,
    student_id integer NOT NULL,
    period_id integer NOT NULL,
    CONSTRAINT chk_rank_in_direction CHECK (((rank_in_direction IS NULL) OR (rank_in_direction >= 1))),
    CONSTRAINT chk_rank_in_group CHECK (((rank_in_group IS NULL) OR (rank_in_group >= 1))),
    CONSTRAINT chk_total_points CHECK ((total_points >= (0)::numeric))
);


--
-- Name: study_direction; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.study_direction (
    direction_id integer NOT NULL,
    code character varying(8) NOT NULL,
    name character varying(255) NOT NULL,
    degree_level character varying(20) NOT NULL,
    department_id integer NOT NULL,
    CONSTRAINT chk_degree_level CHECK (((degree_level)::text = ANY (ARRAY[('bachelor'::character varying)::text, ('specialist'::character varying)::text, ('master'::character varying)::text]))),
    CONSTRAINT chk_direction_code CHECK (((code)::text ~ '^\d{2}\.\d{2}\.\d{2}$'::text))
);


--
-- Name: study_group; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.study_group (
    group_id integer NOT NULL,
    code character varying(20) NOT NULL,
    admission_year smallint NOT NULL,
    direction_id integer NOT NULL,
    CONSTRAINT chk_admission_year CHECK (((admission_year >= 2000) AND (admission_year <= 2100)))
);


--
-- Name: rating_table; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.rating_table AS
 SELECT r.rating_id,
    s.student_id,
    s.full_name AS student_name,
    s.record_book_no,
    g.code AS group_name,
    dr.name AS direction_name,
    p.academic_year,
    p.semester,
    r.total_points,
    r.rank_in_group,
    r.rank_in_direction,
    r.calculated_at
   FROM ((((public.student_rating r
     JOIN public.student s ON ((s.student_id = r.student_id)))
     JOIN public.study_group g ON ((g.group_id = s.group_id)))
     JOIN public.study_direction dr ON ((dr.direction_id = g.direction_id)))
     JOIN public.academic_period p ON ((p.period_id = r.period_id)));


--
-- Name: scoring_rule; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scoring_rule (
    rule_id integer NOT NULL,
    kind character varying(20) NOT NULL,
    points numeric(6,2) NOT NULL,
    result character varying(20),
    valid_from date NOT NULL,
    valid_to date,
    category_id integer NOT NULL,
    level_id integer,
    role_id integer,
    CONSTRAINT chk_rule_kind CHECK (((kind)::text = ANY (ARRAY[('participation'::character varying)::text, ('authorship'::character varying)::text, ('membership'::character varying)::text]))),
    CONSTRAINT chk_rule_points CHECK ((points >= (0)::numeric)),
    CONSTRAINT chk_rule_result CHECK (((result IS NULL) OR ((result)::text = ANY (ARRAY[('no place'::character varying)::text, ('3rd place'::character varying)::text, ('2nd place'::character varying)::text, ('1st place'::character varying)::text, ('grand prix'::character varying)::text])))),
    CONSTRAINT chk_rule_validity CHECK (((valid_to IS NULL) OR (valid_to >= valid_from)))
);


--
-- Name: scoring_rule_rule_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.scoring_rule ALTER COLUMN rule_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.scoring_rule_rule_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: significance_level; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.significance_level (
    level_id integer NOT NULL,
    name character varying(50) NOT NULL,
    rank smallint NOT NULL,
    CONSTRAINT chk_level_rank CHECK (((rank >= 1) AND (rank <= 10)))
);


--
-- Name: significance_level_level_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.significance_level ALTER COLUMN level_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.significance_level_level_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: student_rating_rating_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.student_rating ALTER COLUMN rating_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.student_rating_rating_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: student_student_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.student ALTER COLUMN student_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.student_student_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: study_direction_direction_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.study_direction ALTER COLUMN direction_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.study_direction_direction_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: study_group_group_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.study_group ALTER COLUMN group_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.study_group_group_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: supporting_document; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.supporting_document (
    document_id integer NOT NULL,
    doc_type character varying(30) NOT NULL,
    doc_number character varying(50),
    issued_on date,
    file_ref character varying(500) NOT NULL,
    uploaded_at timestamp with time zone DEFAULT now() NOT NULL,
    achievement_id integer NOT NULL,
    CONSTRAINT chk_doc_type CHECK (((doc_type)::text = ANY (ARRAY[('diploma'::character varying)::text, ('certificate'::character varying)::text, ('certificate of honor'::character varying)::text, ('statement'::character varying)::text, ('publication copy'::character varying)::text, ('order'::character varying)::text, ('other'::character varying)::text])))
);


--
-- Name: supporting_document_document_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.supporting_document ALTER COLUMN document_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.supporting_document_document_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: user_account; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_account (
    account_id integer NOT NULL,
    login character varying(100) NOT NULL,
    password_hash character varying(255) NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    student_id integer,
    employee_id integer,
    CONSTRAINT chk_account_owner CHECK (((student_id IS NOT NULL) <> (employee_id IS NOT NULL)))
);


--
-- Name: user_account_account_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.user_account ALTER COLUMN account_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.user_account_account_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Data for Name: academic_period; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.academic_period (period_id, academic_year, semester, start_date, end_date) OVERRIDING SYSTEM VALUE VALUES (1, '2026/2027', 1, '2026-09-01', '2027-01-31');


--
-- Data for Name: achievement; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.achievement (achievement_id, kind, title, achieved_on, status, points, verified_at, reviewer_comment, student_id, category_id, period_id, rule_id, verified_by) OVERRIDING SYSTEM VALUE VALUES (1, 'participation', '1st place at the Student Scientific Conference', '2026-11-10', 'confirmed', 10.00, '2026-10-12 15:58:51.049504+03', NULL, 1, 1, 1, 1, 2);
INSERT INTO public.achievement (achievement_id, kind, title, achieved_on, status, points, verified_at, reviewer_comment, student_id, category_id, period_id, rule_id, verified_by) OVERRIDING SYSTEM VALUE VALUES (2, 'authorship', 'Publication of an article about PostgreSQL', '2026-10-05', 'confirmed', 15.00, '2026-10-13 00:30:19.947007+03', NULL, 1, 1, 1, 2, 2);
INSERT INTO public.achievement (achievement_id, kind, title, achieved_on, status, points, verified_at, reviewer_comment, student_id, category_id, period_id, rule_id, verified_by) OVERRIDING SYSTEM VALUE VALUES (3, 'membership', 'Membership in the Student Scientific Society', '2026-09-01', 'rejected', NULL, '2026-10-13 00:31:15.929286+03', 'The provided document does not confirm the achievement', 1, 4, 1, NULL, 2);


--
-- Data for Name: achievement_authorship; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.achievement_authorship (achievement_id, student_id, publication_id, author_order) VALUES (2, 1, 1, 1);


--
-- Data for Name: achievement_category; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.achievement_category (category_id, name, description) OVERRIDING SYSTEM VALUE VALUES (1, 'scientific', 'Scientific papers, publications and participation in scientific events');
INSERT INTO public.achievement_category (category_id, name, description) OVERRIDING SYSTEM VALUE VALUES (2, 'creative', 'Creative contests and events');
INSERT INTO public.achievement_category (category_id, name, description) OVERRIDING SYSTEM VALUE VALUES (3, 'sports', 'Sports competitions and achievements');
INSERT INTO public.achievement_category (category_id, name, description) OVERRIDING SYSTEM VALUE VALUES (4, 'social', 'Public and organizational activities');
INSERT INTO public.achievement_category (category_id, name, description) OVERRIDING SYSTEM VALUE VALUES (5, 'olympiad', 'Participation and results in olympiads');


--
-- Data for Name: achievement_event; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.achievement_event (achievement_id, student_id, event_id, role_id, result) VALUES (1, 1, 1, 2, '1st place');


--
-- Data for Name: achievement_membership; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.achievement_membership (achievement_id, student_id, organization_id, "position", joined_on, left_on) VALUES (3, 1, 1, 'participant', '2026-09-01', NULL);


--
-- Data for Name: department; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.department (department_id, name, short_name) OVERRIDING SYSTEM VALUE VALUES (1, 'Department of Information Systems', 'IS');


--
-- Data for Name: employee; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.employee (employee_id, full_name, "position", role_type, email, department_id) OVERRIDING SYSTEM VALUE VALUES (1, 'Petrov Pyotr Sergeevich', 'associate professor', 'lecturer', 'petrov@example.ru', 1);
INSERT INTO public.employee (employee_id, full_name, "position", role_type, email, department_id) OVERRIDING SYSTEM VALUE VALUES (2, 'Petrova Anna Viktorovna', 'deanery specialist', 'deanery staff', 'petrova@example.ru', NULL);


--
-- Data for Name: event; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.event (event_id, title, start_date, end_date, place, event_type_id, level_id, parent_event_id, organization_id) OVERRIDING SYSTEM VALUE VALUES (1, 'Student Scientific Conference', '2026-11-10', '2026-11-10', 'Main building', 2, 1, NULL, 1);
INSERT INTO public.event (event_id, title, start_date, end_date, place, event_type_id, level_id, parent_event_id, organization_id) OVERRIDING SYSTEM VALUE VALUES (2, 'Information Technology Section', '2026-11-10', '2026-11-10', 'Room 101', 2, 1, 1, NULL);


--
-- Data for Name: event_type; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.event_type (event_type_id, name) OVERRIDING SYSTEM VALUE VALUES (1, 'olympiad');
INSERT INTO public.event_type (event_type_id, name) OVERRIDING SYSTEM VALUE VALUES (2, 'conference');
INSERT INTO public.event_type (event_type_id, name) OVERRIDING SYSTEM VALUE VALUES (3, 'contest');
INSERT INTO public.event_type (event_type_id, name) OVERRIDING SYSTEM VALUE VALUES (4, 'competition');
INSERT INTO public.event_type (event_type_id, name) OVERRIDING SYSTEM VALUE VALUES (5, 'hackathon');


--
-- Data for Name: organization; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.organization (organization_id, name, org_type, founded_on, is_active, curator_id) OVERRIDING SYSTEM VALUE VALUES (1, 'Student Scientific Society', 'scientific society', '2024-09-01', true, NULL);


--
-- Data for Name: participation_role; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.participation_role (role_id, name) OVERRIDING SYSTEM VALUE VALUES (1, 'participant');
INSERT INTO public.participation_role (role_id, name) OVERRIDING SYSTEM VALUE VALUES (2, 'speaker');
INSERT INTO public.participation_role (role_id, name) OVERRIDING SYSTEM VALUE VALUES (3, 'organizer');
INSERT INTO public.participation_role (role_id, name) OVERRIDING SYSTEM VALUE VALUES (4, 'volunteer');


--
-- Data for Name: publication; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.publication (publication_id, title, published_on, doi, pages, source_id, supervisor_id) OVERRIDING SYSTEM VALUE VALUES (1, 'Using PostgreSQL in Information Systems', '2026-10-05', '10.1234/student.2026.001', '15-22', 1, 1);


--
-- Data for Name: publication_source; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.publication_source (source_id, name, issn, source_type, level_id) OVERRIDING SYSTEM VALUE VALUES (1, 'Bulletin of Student Science', '1234-567X', 'RSCI journal', 3);


--
-- Data for Name: scoring_rule; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.scoring_rule (rule_id, kind, points, result, valid_from, valid_to, category_id, level_id, role_id) OVERRIDING SYSTEM VALUE VALUES (1, 'participation', 10.00, '1st place', '2026-09-01', NULL, 1, 1, 2);
INSERT INTO public.scoring_rule (rule_id, kind, points, result, valid_from, valid_to, category_id, level_id, role_id) OVERRIDING SYSTEM VALUE VALUES (2, 'authorship', 15.00, NULL, '2026-09-01', NULL, 1, 3, NULL);


--
-- Data for Name: significance_level; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.significance_level (level_id, name, rank) OVERRIDING SYSTEM VALUE VALUES (1, 'university', 1);
INSERT INTO public.significance_level (level_id, name, rank) OVERRIDING SYSTEM VALUE VALUES (2, 'regional', 2);
INSERT INTO public.significance_level (level_id, name, rank) OVERRIDING SYSTEM VALUE VALUES (3, 'national', 3);
INSERT INTO public.significance_level (level_id, name, rank) OVERRIDING SYSTEM VALUE VALUES (4, 'international', 4);


--
-- Data for Name: student; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.student (student_id, record_book_no, full_name, birth_date, email, status, group_id) OVERRIDING SYSTEM VALUE VALUES (1, '2024-001', 'Ivanov Ivan Ivanovich', '2006-05-15', 'ivanov@example.ru', 'studying', 1);


--
-- Data for Name: student_rating; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.student_rating (rating_id, total_points, rank_in_group, rank_in_direction, calculated_at, student_id, period_id) OVERRIDING SYSTEM VALUE VALUES (1, 25.00, 1, 1, '2026-10-13 00:31:15.929286+03', 1, 1);


--
-- Data for Name: study_direction; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.study_direction (direction_id, code, name, degree_level, department_id) OVERRIDING SYSTEM VALUE VALUES (1, '09.03.01', 'Computer Science and Engineering', 'bachelor', 1);


--
-- Data for Name: study_group; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.study_group (group_id, code, admission_year, direction_id) OVERRIDING SYSTEM VALUE VALUES (1, 'CSE-24-1', 2024, 1);


--
-- Data for Name: supporting_document; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.supporting_document (document_id, doc_type, doc_number, issued_on, file_ref, uploaded_at, achievement_id) OVERRIDING SYSTEM VALUE VALUES (1, 'diploma', 'DIP-2026-001', '2026-11-10', '/documents/diplom-2026-001.pdf', '2026-10-12 13:11:41.455116+03', 1);
INSERT INTO public.supporting_document (document_id, doc_type, doc_number, issued_on, file_ref, uploaded_at, achievement_id) OVERRIDING SYSTEM VALUE VALUES (2, 'publication copy', NULL, '2026-10-05', '/documents/publication-postgresql.pdf', '2026-10-13 00:30:05.847048+03', 2);


--
-- Data for Name: user_account; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Name: academic_period_period_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.academic_period_period_id_seq', 2, false);


--
-- Name: achievement_achievement_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.achievement_achievement_id_seq', 4, false);


--
-- Name: achievement_category_category_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.achievement_category_category_id_seq', 6, false);


--
-- Name: department_department_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.department_department_id_seq', 2, false);


--
-- Name: employee_employee_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.employee_employee_id_seq', 3, false);


--
-- Name: event_event_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.event_event_id_seq', 3, false);


--
-- Name: event_type_event_type_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.event_type_event_type_id_seq', 6, false);


--
-- Name: organization_organization_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.organization_organization_id_seq', 2, false);


--
-- Name: participation_role_role_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.participation_role_role_id_seq', 5, false);


--
-- Name: publication_publication_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.publication_publication_id_seq', 2, false);


--
-- Name: publication_source_source_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.publication_source_source_id_seq', 2, false);


--
-- Name: scoring_rule_rule_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.scoring_rule_rule_id_seq', 3, false);


--
-- Name: significance_level_level_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.significance_level_level_id_seq', 5, false);


--
-- Name: student_rating_rating_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.student_rating_rating_id_seq', 2, false);


--
-- Name: student_student_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.student_student_id_seq', 2, false);


--
-- Name: study_direction_direction_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.study_direction_direction_id_seq', 2, false);


--
-- Name: study_group_group_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.study_group_group_id_seq', 2, false);


--
-- Name: supporting_document_document_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.supporting_document_document_id_seq', 3, false);


--
-- Name: user_account_account_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.user_account_account_id_seq', 1, false);


--
-- Name: academic_period academic_period_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.academic_period
    ADD CONSTRAINT academic_period_pkey PRIMARY KEY (period_id);


--
-- Name: achievement_authorship achievement_authorship_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.achievement_authorship
    ADD CONSTRAINT achievement_authorship_pkey PRIMARY KEY (achievement_id);


--
-- Name: achievement_category achievement_category_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.achievement_category
    ADD CONSTRAINT achievement_category_name_key UNIQUE (name);


--
-- Name: achievement_category achievement_category_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.achievement_category
    ADD CONSTRAINT achievement_category_pkey PRIMARY KEY (category_id);


--
-- Name: achievement_event achievement_event_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.achievement_event
    ADD CONSTRAINT achievement_event_pkey PRIMARY KEY (achievement_id);


--
-- Name: achievement_membership achievement_membership_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.achievement_membership
    ADD CONSTRAINT achievement_membership_pkey PRIMARY KEY (achievement_id);


--
-- Name: achievement achievement_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.achievement
    ADD CONSTRAINT achievement_pkey PRIMARY KEY (achievement_id);


--
-- Name: department department_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.department
    ADD CONSTRAINT department_name_key UNIQUE (name);


--
-- Name: department department_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.department
    ADD CONSTRAINT department_pkey PRIMARY KEY (department_id);


--
-- Name: department department_short_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.department
    ADD CONSTRAINT department_short_name_key UNIQUE (short_name);


--
-- Name: employee employee_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee
    ADD CONSTRAINT employee_email_key UNIQUE (email);


--
-- Name: employee employee_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee
    ADD CONSTRAINT employee_pkey PRIMARY KEY (employee_id);


--
-- Name: event event_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event
    ADD CONSTRAINT event_pkey PRIMARY KEY (event_id);


--
-- Name: event_type event_type_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_type
    ADD CONSTRAINT event_type_name_key UNIQUE (name);


--
-- Name: event_type event_type_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_type
    ADD CONSTRAINT event_type_pkey PRIMARY KEY (event_type_id);


--
-- Name: academic_period excl_academic_period_overlap; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.academic_period
    ADD CONSTRAINT excl_academic_period_overlap EXCLUDE USING gist (daterange(start_date, end_date, '[]'::text) WITH &&);


--
-- Name: achievement_membership excl_membership_overlap; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.achievement_membership
    ADD CONSTRAINT excl_membership_overlap EXCLUDE USING gist (student_id WITH =, organization_id WITH =, daterange(joined_on, COALESCE(left_on, 'infinity'::date), '[]'::text) WITH &&);


--
-- Name: scoring_rule excl_scoring_rule_overlap; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scoring_rule
    ADD CONSTRAINT excl_scoring_rule_overlap EXCLUDE USING gist (kind WITH =, category_id WITH =, COALESCE(level_id, 0) WITH =, COALESCE(role_id, 0) WITH =, COALESCE(result, '*'::character varying) WITH =, daterange(valid_from, COALESCE(valid_to, 'infinity'::date), '[]'::text) WITH &&);


--
-- Name: organization organization_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization
    ADD CONSTRAINT organization_name_key UNIQUE (name);


--
-- Name: organization organization_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization
    ADD CONSTRAINT organization_pkey PRIMARY KEY (organization_id);


--
-- Name: participation_role participation_role_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.participation_role
    ADD CONSTRAINT participation_role_name_key UNIQUE (name);


--
-- Name: participation_role participation_role_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.participation_role
    ADD CONSTRAINT participation_role_pkey PRIMARY KEY (role_id);


--
-- Name: publication publication_doi_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.publication
    ADD CONSTRAINT publication_doi_key UNIQUE (doi);


--
-- Name: publication publication_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.publication
    ADD CONSTRAINT publication_pkey PRIMARY KEY (publication_id);


--
-- Name: publication_source publication_source_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.publication_source
    ADD CONSTRAINT publication_source_pkey PRIMARY KEY (source_id);


--
-- Name: scoring_rule scoring_rule_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scoring_rule
    ADD CONSTRAINT scoring_rule_pkey PRIMARY KEY (rule_id);


--
-- Name: significance_level significance_level_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.significance_level
    ADD CONSTRAINT significance_level_name_key UNIQUE (name);


--
-- Name: significance_level significance_level_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.significance_level
    ADD CONSTRAINT significance_level_pkey PRIMARY KEY (level_id);


--
-- Name: significance_level significance_level_rank_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.significance_level
    ADD CONSTRAINT significance_level_rank_key UNIQUE (rank);


--
-- Name: student student_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student
    ADD CONSTRAINT student_email_key UNIQUE (email);


--
-- Name: student student_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student
    ADD CONSTRAINT student_pkey PRIMARY KEY (student_id);


--
-- Name: student_rating student_rating_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_rating
    ADD CONSTRAINT student_rating_pkey PRIMARY KEY (rating_id);


--
-- Name: student student_record_book_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student
    ADD CONSTRAINT student_record_book_no_key UNIQUE (record_book_no);


--
-- Name: study_direction study_direction_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_direction
    ADD CONSTRAINT study_direction_code_key UNIQUE (code);


--
-- Name: study_direction study_direction_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_direction
    ADD CONSTRAINT study_direction_pkey PRIMARY KEY (direction_id);


--
-- Name: study_group study_group_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_group
    ADD CONSTRAINT study_group_code_key UNIQUE (code);


--
-- Name: study_group study_group_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_group
    ADD CONSTRAINT study_group_pkey PRIMARY KEY (group_id);


--
-- Name: supporting_document supporting_document_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supporting_document
    ADD CONSTRAINT supporting_document_pkey PRIMARY KEY (document_id);


--
-- Name: academic_period uq_academic_period; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.academic_period
    ADD CONSTRAINT uq_academic_period UNIQUE (academic_year, semester);


--
-- Name: achievement uq_achievement_student; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.achievement
    ADD CONSTRAINT uq_achievement_student UNIQUE (achievement_id, student_id);


--
-- Name: achievement_authorship uq_author_order; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.achievement_authorship
    ADD CONSTRAINT uq_author_order UNIQUE (publication_id, author_order);


--
-- Name: achievement_event uq_participation; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.achievement_event
    ADD CONSTRAINT uq_participation UNIQUE (student_id, event_id, role_id);


--
-- Name: achievement_authorship uq_publication_author; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.achievement_authorship
    ADD CONSTRAINT uq_publication_author UNIQUE (publication_id, student_id);


--
-- Name: publication_source uq_publication_source; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.publication_source
    ADD CONSTRAINT uq_publication_source UNIQUE (name, source_type);


--
-- Name: student_rating uq_student_period_rating; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_rating
    ADD CONSTRAINT uq_student_period_rating UNIQUE (student_id, period_id);


--
-- Name: user_account user_account_employee_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_account
    ADD CONSTRAINT user_account_employee_id_key UNIQUE (employee_id);


--
-- Name: user_account user_account_login_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_account
    ADD CONSTRAINT user_account_login_key UNIQUE (login);


--
-- Name: user_account user_account_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_account
    ADD CONSTRAINT user_account_pkey PRIMARY KEY (account_id);


--
-- Name: user_account user_account_student_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_account
    ADD CONSTRAINT user_account_student_id_key UNIQUE (student_id);


--
-- Name: idx_achievement_student_period; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_achievement_student_period ON public.achievement USING btree (student_id, period_id, status);


--
-- Name: idx_document_achievement; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_document_achievement ON public.supporting_document USING btree (achievement_id);


--
-- Name: idx_event_level; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_event_level ON public.event USING btree (level_id);


--
-- Name: idx_event_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_event_type ON public.event USING btree (event_type_id);


--
-- Name: idx_publication_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_publication_source ON public.publication USING btree (source_id);


--
-- Name: idx_rating_period_points; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rating_period_points ON public.student_rating USING btree (period_id, total_points DESC);


--
-- Name: idx_student_group; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_student_group ON public.student USING btree (group_id);


--
-- Name: achievement check_achievement_confirmation_trg; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER check_achievement_confirmation_trg BEFORE INSERT OR UPDATE ON public.achievement FOR EACH ROW EXECUTE FUNCTION public.check_achievement_confirmation();


--
-- Name: achievement_authorship check_authorship_kind; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER check_authorship_kind BEFORE INSERT OR UPDATE ON public.achievement_authorship FOR EACH ROW EXECUTE FUNCTION public.check_achievement_subtype_kind();


--
-- Name: event check_event_cycle_trg; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER check_event_cycle_trg BEFORE INSERT OR UPDATE OF parent_event_id ON public.event FOR EACH ROW EXECUTE FUNCTION public.check_event_cycle();


--
-- Name: achievement_membership check_membership_kind; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER check_membership_kind BEFORE INSERT OR UPDATE ON public.achievement_membership FOR EACH ROW EXECUTE FUNCTION public.check_achievement_subtype_kind();


--
-- Name: achievement_event check_participation_kind; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER check_participation_kind BEFORE INSERT OR UPDATE ON public.achievement_event FOR EACH ROW EXECUTE FUNCTION public.check_achievement_subtype_kind();


--
-- Name: publication check_publication_supervisor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER check_publication_supervisor BEFORE INSERT OR UPDATE OF supervisor_id ON public.publication FOR EACH ROW EXECUTE FUNCTION public.check_supervisor();


--
-- Name: achievement forbid_expelled_student_achievements; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER forbid_expelled_student_achievements BEFORE INSERT ON public.achievement FOR EACH ROW EXECUTE FUNCTION public.check_student_status_on_achievement();


--
-- Name: achievement trg_rating_on_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_rating_on_change AFTER UPDATE OF status, points, period_id, student_id ON public.achievement FOR EACH ROW EXECUTE FUNCTION public.recalculate_rating_trigger();


--
-- Name: achievement trg_rating_on_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_rating_on_delete AFTER DELETE ON public.achievement FOR EACH ROW EXECUTE FUNCTION public.recalculate_rating_trigger();


--
-- Name: user_account fk_account_employee; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_account
    ADD CONSTRAINT fk_account_employee FOREIGN KEY (employee_id) REFERENCES public.employee(employee_id) ON DELETE CASCADE;


--
-- Name: user_account fk_account_student; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_account
    ADD CONSTRAINT fk_account_student FOREIGN KEY (student_id) REFERENCES public.student(student_id) ON DELETE CASCADE;


--
-- Name: achievement fk_achievement_category; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.achievement
    ADD CONSTRAINT fk_achievement_category FOREIGN KEY (category_id) REFERENCES public.achievement_category(category_id) ON DELETE RESTRICT;


--
-- Name: achievement fk_achievement_period; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.achievement
    ADD CONSTRAINT fk_achievement_period FOREIGN KEY (period_id) REFERENCES public.academic_period(period_id) ON DELETE RESTRICT;


--
-- Name: achievement fk_achievement_reviewer; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.achievement
    ADD CONSTRAINT fk_achievement_reviewer FOREIGN KEY (verified_by) REFERENCES public.employee(employee_id) ON DELETE RESTRICT;


--
-- Name: achievement fk_achievement_rule; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.achievement
    ADD CONSTRAINT fk_achievement_rule FOREIGN KEY (rule_id) REFERENCES public.scoring_rule(rule_id) ON DELETE RESTRICT;


--
-- Name: achievement fk_achievement_student; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.achievement
    ADD CONSTRAINT fk_achievement_student FOREIGN KEY (student_id) REFERENCES public.student(student_id) ON DELETE RESTRICT;


--
-- Name: achievement_authorship fk_authorship_achievement; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.achievement_authorship
    ADD CONSTRAINT fk_authorship_achievement FOREIGN KEY (achievement_id, student_id) REFERENCES public.achievement(achievement_id, student_id) ON DELETE CASCADE;


--
-- Name: achievement_authorship fk_authorship_publication; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.achievement_authorship
    ADD CONSTRAINT fk_authorship_publication FOREIGN KEY (publication_id) REFERENCES public.publication(publication_id) ON DELETE RESTRICT;


--
-- Name: achievement_authorship fk_authorship_student; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.achievement_authorship
    ADD CONSTRAINT fk_authorship_student FOREIGN KEY (student_id) REFERENCES public.student(student_id) ON DELETE RESTRICT;


--
-- Name: study_direction fk_direction_department; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_direction
    ADD CONSTRAINT fk_direction_department FOREIGN KEY (department_id) REFERENCES public.department(department_id) ON DELETE RESTRICT;


--
-- Name: supporting_document fk_document_achievement; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supporting_document
    ADD CONSTRAINT fk_document_achievement FOREIGN KEY (achievement_id) REFERENCES public.achievement(achievement_id) ON DELETE CASCADE;


--
-- Name: employee fk_employee_department; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee
    ADD CONSTRAINT fk_employee_department FOREIGN KEY (department_id) REFERENCES public.department(department_id) ON DELETE SET NULL;


--
-- Name: event fk_event_level; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event
    ADD CONSTRAINT fk_event_level FOREIGN KEY (level_id) REFERENCES public.significance_level(level_id) ON DELETE RESTRICT;


--
-- Name: event fk_event_organization; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event
    ADD CONSTRAINT fk_event_organization FOREIGN KEY (organization_id) REFERENCES public.organization(organization_id) ON DELETE SET NULL;


--
-- Name: event fk_event_parent; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event
    ADD CONSTRAINT fk_event_parent FOREIGN KEY (parent_event_id) REFERENCES public.event(event_id) ON DELETE RESTRICT;


--
-- Name: event fk_event_type; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event
    ADD CONSTRAINT fk_event_type FOREIGN KEY (event_type_id) REFERENCES public.event_type(event_type_id) ON DELETE RESTRICT;


--
-- Name: study_group fk_group_direction; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.study_group
    ADD CONSTRAINT fk_group_direction FOREIGN KEY (direction_id) REFERENCES public.study_direction(direction_id) ON DELETE RESTRICT;


--
-- Name: achievement_membership fk_membership_achievement; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.achievement_membership
    ADD CONSTRAINT fk_membership_achievement FOREIGN KEY (achievement_id, student_id) REFERENCES public.achievement(achievement_id, student_id) ON DELETE CASCADE;


--
-- Name: achievement_membership fk_membership_organization; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.achievement_membership
    ADD CONSTRAINT fk_membership_organization FOREIGN KEY (organization_id) REFERENCES public.organization(organization_id) ON DELETE RESTRICT;


--
-- Name: achievement_membership fk_membership_student; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.achievement_membership
    ADD CONSTRAINT fk_membership_student FOREIGN KEY (student_id) REFERENCES public.student(student_id) ON DELETE RESTRICT;


--
-- Name: organization fk_organization_curator; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization
    ADD CONSTRAINT fk_organization_curator FOREIGN KEY (curator_id) REFERENCES public.employee(employee_id) ON DELETE SET NULL;


--
-- Name: achievement_event fk_participation_achievement; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.achievement_event
    ADD CONSTRAINT fk_participation_achievement FOREIGN KEY (achievement_id, student_id) REFERENCES public.achievement(achievement_id, student_id) ON DELETE CASCADE;


--
-- Name: achievement_event fk_participation_event; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.achievement_event
    ADD CONSTRAINT fk_participation_event FOREIGN KEY (event_id) REFERENCES public.event(event_id) ON DELETE RESTRICT;


--
-- Name: achievement_event fk_participation_role; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.achievement_event
    ADD CONSTRAINT fk_participation_role FOREIGN KEY (role_id) REFERENCES public.participation_role(role_id) ON DELETE RESTRICT;


--
-- Name: achievement_event fk_participation_student; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.achievement_event
    ADD CONSTRAINT fk_participation_student FOREIGN KEY (student_id) REFERENCES public.student(student_id) ON DELETE RESTRICT;


--
-- Name: publication fk_publication_source; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.publication
    ADD CONSTRAINT fk_publication_source FOREIGN KEY (source_id) REFERENCES public.publication_source(source_id) ON DELETE RESTRICT;


--
-- Name: publication fk_publication_supervisor; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.publication
    ADD CONSTRAINT fk_publication_supervisor FOREIGN KEY (supervisor_id) REFERENCES public.employee(employee_id) ON DELETE SET NULL;


--
-- Name: student_rating fk_rating_period; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_rating
    ADD CONSTRAINT fk_rating_period FOREIGN KEY (period_id) REFERENCES public.academic_period(period_id) ON DELETE RESTRICT;


--
-- Name: student_rating fk_rating_student; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_rating
    ADD CONSTRAINT fk_rating_student FOREIGN KEY (student_id) REFERENCES public.student(student_id) ON DELETE CASCADE;


--
-- Name: scoring_rule fk_rule_category; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scoring_rule
    ADD CONSTRAINT fk_rule_category FOREIGN KEY (category_id) REFERENCES public.achievement_category(category_id) ON DELETE RESTRICT;


--
-- Name: scoring_rule fk_rule_level; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scoring_rule
    ADD CONSTRAINT fk_rule_level FOREIGN KEY (level_id) REFERENCES public.significance_level(level_id) ON DELETE RESTRICT;


--
-- Name: scoring_rule fk_rule_role; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scoring_rule
    ADD CONSTRAINT fk_rule_role FOREIGN KEY (role_id) REFERENCES public.participation_role(role_id) ON DELETE RESTRICT;


--
-- Name: publication_source fk_source_level; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.publication_source
    ADD CONSTRAINT fk_source_level FOREIGN KEY (level_id) REFERENCES public.significance_level(level_id) ON DELETE RESTRICT;


--
-- Name: student fk_student_group; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student
    ADD CONSTRAINT fk_student_group FOREIGN KEY (group_id) REFERENCES public.study_group(group_id) ON DELETE RESTRICT;


--
-- PostgreSQL database dump complete
--


