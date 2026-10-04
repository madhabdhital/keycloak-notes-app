package com.surelm.notes_backend;

import java.util.List;

import org.springframework.data.jpa.repository.JpaRepository;

public interface NoteRepository extends JpaRepository<Note, Long> {
    List<Note> findByOwnerId(String ownerId);
}